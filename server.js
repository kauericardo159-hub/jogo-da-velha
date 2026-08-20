const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Servir arquivos estáticos (HTML, CSS, JS) se colocados na mesma pasta ou public
app.use(express.static(path.join(__dirname, './')));

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const salas = {};
let usuariosOnline = 0;

function obterTotalJogando() {
    let jogando = 0;
    for (const nomeSala in salas) {
        jogando += salas[nomeSala].length;
    }
    return jogando;
}

function atualizarEstatisticasGlobais() {
    io.emit('status-global', {
        online: usuariosOnline,
        jogando: obterTotalJogando()
    });
}

function enviarListaSalas() {
    const lista = Object.keys(salas).map(nome => ({
        nome: nome,
        jogadores: salas[nome].length,
        max: 2
    }));
    io.emit('lista-salas', lista);
}

io.on('connection', (socket) => {
    usuariosOnline++;
    atualizarEstatisticasGlobais();
    enviarListaSalas();

    // Atualiza nome/avatar do usuário no servidor
    socket.on('atualizar-perfil', (perfil) => {
        socket.perfil = {
            nome: perfil.nome || "Jogador",
            avatar: perfil.avatar || "https://i.imgur.com/6VBx3io.png"
        };
    });

    socket.on('entrar-na-sala', (data) => {
        const nomeSala = typeof data === 'string' ? data : data.nomeSala;
        
        if (!salas[nomeSala]) {
            salas[nomeSala] = [];
        }

        const jogadoresNaSala = salas[nomeSala];

        if (jogadoresNaSala.length >= 2) {
            socket.emit('status-erro', 'Esta sala já está cheia!');
            return;
        }

        const simbolo = jogadoresNaSala.length === 0 ? "X" : "O";
        const perfilJogador = socket.perfil || { nome: "Jogador", avatar: "https://i.imgur.com/6VBx3io.png" };

        const novoJogador = {
            id: socket.id,
            simbolo: simbolo,
            nome: perfilJogador.nome,
            avatar: perfilJogador.avatar
        };

        jogadoresNaSala.push(novoJogador);
        socket.join(nomeSala);

        socket.emit('player-assignment', {
            simbolo: simbolo,
            jogadores: jogadoresNaSala
        });

        // Notifica o oponente se já houver alguém na sala
        socket.to(nomeSala).emit('oponente-entrou', novoJogador);

        if (jogadoresNaSala.length === 2) {
            io.to(nomeSala).emit('start-game', { jogadores: jogadoresNaSala });
        }

        enviarListaSalas();
        atualizarEstatisticasGlobais();
    });

    socket.on('make-move', (dados) => {
        socket.to(dados.sala).emit('move-made', dados);
    });

    socket.on('sair-da-sala', (nomeSala) => {
        sairDaSala(socket, nomeSala);
    });

    socket.on('disconnect', () => {
        usuariosOnline--;
        for (const nomeSala in salas) {
            sairDaSala(socket, nomeSala);
        }
        atualizarEstatisticasGlobais();
    });
});

function sairDaSala(socket, nomeSala) {
    if (salas[nomeSala]) {
        salas[nomeSala] = salas[nomeSala].filter(j => j.id !== socket.id);
        socket.leave(nomeSala);
        io.to(nomeSala).emit('player-disconnected');

        if (salas[nomeSala].length === 0) {
            delete salas[nomeSala];
        }
        enviarListaSalas();
        atualizarEstatisticasGlobais();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor Neon Arcade rodando na porta ${PORT}`));
