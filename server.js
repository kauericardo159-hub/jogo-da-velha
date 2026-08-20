const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Servir arquivos estáticos do projeto
app.use(express.static(path.join(__dirname, './')));

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// URL de conexão do Supabase
const DATABASE_URL = "postgresql://postgres:%23Ka32210032_Proto@db.lgobrnkhbuspskbkppsd.supabase.co:5432/postgres";

const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => console.log("🟢 Conectado ao Supabase (PostgreSQL)!"))
    .catch(err => console.error("🔴 Erro ao conectar no Supabase:", err));

// Gerenciamento de Estado do Servidor
const salas = {}; // Formato: { nomeSala: { senha: "", jogadores: [] } }
const usuariosAtivos = new Map(); 
const tempoInicioServidor = Date.now();

// Função para obter país via cabeçalhos de rede (Render / Cloudflare)
function obterPaisDoCliente(req) {
    const country = req.headers['cf-ipcountry'] || req.headers['x-appengine-country'];
    if (country && country !== 'XX') return country.toUpperCase();
    return 'BR'; 
}

// Retorna total de pessoas jogando em salas
function obterTotalJogando() {
    let jogando = 0;
    for (const nomeSala in salas) {
        jogando += salas[nomeSala].jogadores.length;
    }
    return jogando;
}

// Retorna tempo online do servidor em formato legível (HH:MM:SS)
function obterUptimeServidor() {
    const segundosTotais = Math.floor((Date.now() - tempoInicioServidor) / 1000);
    const horas = Math.floor(segundosTotais / 3600);
    const minutos = Math.floor((segundosTotais % 3600) / 60);
    const segundos = segundosTotais % 60;
    return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
}

// Transmite o estado do servidor e a lista global de jogadores
function transmitirEstadoGlobal() {
    const listaJogadores = Array.from(usuariosAtivos.values()).map(u => ({
        id: u.id,
        nome: u.nome,
        avatar: u.avatar,
        vitorias: u.vitorias,
        pais: u.pais
    }));

    const usoMemoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    io.emit('status-global', {
        online: usuariosAtivos.size,
        jogando: obterTotalJogando(),
        uptime: obterUptimeServidor(),
        memoria: `${usoMemoria} MB`,
        totalSalas: Object.keys(salas).length,
        jogadoresOnline: listaJogadores
    });
}

// Envia a lista pública de salas (ocultando a senha)
function enviarListaSalas(socketAlvo = null) {
    const lista = Object.keys(salas).map(nome => ({
        nome: nome,
        privada: !!salas[nome].senha,
        jogadores: salas[nome].jogadores.length,
        max: 2,
        jogadoresInfo: salas[nome].jogadores.map(j => ({ nome: j.nome, avatar: j.avatar }))
    }));

    if (socketAlvo) {
        socketAlvo.emit('lista-salas', lista);
    } else {
        io.emit('lista-salas', lista);
    }
}

io.on('connection', (socket) => {
    const req = socket.request;
    socket.pais = obterPaisDoCliente(req);

    // Medição de Ping Heartbeat
    socket.on('ping-check', (timestamp, callback) => {
        if (typeof callback === 'function') {
            callback(timestamp);
        }
    });

    // Autenticação / Cadastro
    socket.on('autenticar', async (dados) => {
        const { username, password, avatar_url } = dados;

        try {
            let user;
            const res = await db.query('SELECT * FROM jogadores WHERE username = $1', [username]);

            if (res.rows.length > 0) {
                user = res.rows[0];
                if (user.password !== password) {
                    socket.emit('auth-erro', 'Senha incorreta para esta conta!');
                    return;
                }
                if (avatar_url && avatar_url !== user.avatar_url) {
                    await db.query('UPDATE jogadores SET avatar_url = $1 WHERE id = $2', [avatar_url, user.id]);
                    user.avatar_url = avatar_url;
                }
            } else {
                const novo = await db.query(
                    'INSERT INTO jogadores (username, password, avatar_url, vitorias) VALUES ($1, $2, $3, 0) RETURNING *',
                    [username, password, avatar_url || 'https://i.imgur.com/6VBx3io.png']
                );
                user = novo.rows[0];
            }

            socket.perfil = {
                id: user.id,
                nome: user.username,
                avatar: user.avatar_url,
                vitorias: user.vitorias,
                pais: socket.pais
            };

            if (usuariosAtivos.has(user.id)) {
                usuariosAtivos.get(user.id).conexoes++;
            } else {
                usuariosAtivos.set(user.id, {
                    id: user.id,
                    nome: user.username,
                    avatar: user.avatar_url,
                    vitorias: user.vitorias,
                    pais: socket.pais,
                    conexoes: 1
                });
            }

            socket.emit('auth-sucesso', socket.perfil);
            transmitirEstadoGlobal();
            enviarListaSalas(socket);

        } catch (err) {
            console.error("Erro na autenticação:", err);
            socket.emit('auth-erro', 'Erro de conexão com o banco de dados.');
        }
    });

    // Criar / Entrar na Sala
    socket.on('entrar-na-sala', (data) => {
        const nomeSala = (data.nomeSala || "").trim();
        const senhaInserida = (data.senha || "").trim();

        if (!nomeSala) {
            socket.emit('status-erro', 'O nome da sala não pode ser vazio!');
            return;
        }

        // Se a sala não existe, cria uma nova sala com a senha informada (se houver)
        if (!salas[nomeSala]) {
            salas[nomeSala] = {
                senha: senhaInserida,
                jogadores: []
            };
        } else {
            // Se a sala já existe, valida a senha se ela for privada
            if (salas[nomeSala].senha && salas[nomeSala].senha !== senhaInserida) {
                socket.emit('status-erro', 'Senha incorreta para esta sala!');
                return;
            }
        }

        const salaObjeto = salas[nomeSala];

        if (salaObjeto.jogadores.length >= 2) {
            socket.emit('status-erro', 'Esta sala já está cheia!');
            return;
        }

        const simbolo = salaObjeto.jogadores.length === 0 ? "X" : "O";
        const perfilJogador = socket.perfil || { id: socket.id, nome: "Jogador", avatar: "https://i.imgur.com/6VBx3io.png", pais: "BR" };

        const novoJogador = {
            socketId: socket.id,
            dbId: perfilJogador.id,
            simbolo: simbolo,
            nome: perfilJogador.nome,
            avatar: perfilJogador.avatar,
            pais: perfilJogador.pais
        };

        salaObjeto.jogadores.push(novoJogador);
        socket.join(nomeSala);

        socket.emit('player-assignment', {
            simbolo: simbolo,
            jogadores: salaObjeto.jogadores
        });

        socket.to(nomeSala).emit('oponente-entrou', novoJogador);

        if (salaObjeto.jogadores.length === 2) {
            io.to(nomeSala).emit('start-game', { jogadores: salaObjeto.jogadores });
        }

        enviarListaSalas();
        transmitirEstadoGlobal();
    });

    // Movimento do jogo
    socket.on('make-move', (dados) => {
        socket.to(dados.sala).emit('move-made', dados);
    });

    // Registro de vitória online no Supabase
    socket.on('registrar-vitoria', async () => {
        if (socket.perfil && socket.perfil.id) {
            try {
                await db.query('UPDATE jogadores SET vitorias = vitorias + 1 WHERE id = $1', [socket.perfil.id]);
                socket.perfil.vitorias++;
                if (usuariosAtivos.has(socket.perfil.id)) {
                    usuariosAtivos.get(socket.perfil.id).vitorias++;
                }
                transmitirEstadoGlobal();
            } catch (err) {
                console.error("Erro ao registrar vitória:", err);
            }
        }
    });

    socket.on('sair-da-sala', (nomeSala) => {
        sairDaSala(socket, nomeSala);
    });

    // Desconexão
    socket.on('disconnect', () => {
        if (socket.perfil && socket.perfil.id) {
            const usuario = usuariosAtivos.get(socket.perfil.id);
            if (usuario) {
                usuario.conexoes--;
                if (usuario.conexoes <= 0) {
                    usuariosAtivos.delete(socket.perfil.id);
                }
            }
        }

        for (const nomeSala in salas) {
            sairDaSala(socket, nomeSala);
        }

        transmitirEstadoGlobal();
    });
});

function sairDaSala(socket, nomeSala) {
    if (salas[nomeSala]) {
        salas[nomeSala].jogadores = salas[nomeSala].jogadores.filter(j => j.socketId !== socket.id);
        socket.leave(nomeSala);
        io.to(nomeSala).emit('player-disconnected');

        if (salas[nomeSala].jogadores.length === 0) {
            delete salas[nomeSala];
        }
        enviarListaSalas();
        transmitirEstadoGlobal();
    }
}

// Atualização de métricas do servidor periodicamente
setInterval(() => {
    transmitirEstadoGlobal();
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`));
