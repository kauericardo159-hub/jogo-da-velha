const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Estrutura das salas: 
// { "nomeDaSala": { jogadores: [ { id, simbolo, nome, foto } ] } }
const salas = {};

/**
 * Função utilitária para mapear e enviar a lista de salas públicas disponíveis 
 * para todos os usuários que estão ociosos no lobby.
 */
function enviarListaSalas(destino = io) {
    const lista = Object.keys(salas).map(nomeSala => {
        const jogadores = salas[nomeSala].jogadores;
        const dono = jogadores[0]; // O primeiro a entrar é o dono da sala
        return {
            nome: nomeSala,
            jogadores: jogadores.length,
            donoNome: dono ? dono.nome : "Desconhecido",
            donoFoto: dono ? dono.foto : ""
        };
    });
    destino.emit('lista-salas', lista);
}

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    // Envia as salas disponíveis imediatamente assim que o cliente conecta no lobby
    enviarListaSalas(socket);

    // O jogador pede para entrar ou criar uma sala
    socket.on('entrar-na-sala', (dados) => {
        const nomeSala = dados.sala;
        const jogadorNome = dados.jogadorNome || "Jogador Anônimo";
        const jogadorFoto = dados.jogadorFoto || "";

        if (!nomeSala) return;

        // Se a sala não existe, inicializa a estrutura
        if (!salas[nomeSala]) {
            salas[nomeSala] = { jogadores: [] };
        }

        const salaAtiva = salas[nomeSala];

        // Se a sala já tiver 2 jogadores, impede o terceiro de entrar
        if (salaAtiva.jogadores.length >= 2) {
            socket.emit('status', 'Sala cheia');
            return;
        }

        // Define o símbolo dinamicamente (Primeiro a entrar = X, Segundo = O)
        const simbolo = salaAtiva.jogadores.length === 0 ? "X" : "O";
        
        // Estrutura do novo jogador com metadados de perfil
        const novoJogador = { 
            id: socket.id, 
            simbolo: simbolo, 
            nome: jogadorNome, 
            foto: jogadorFoto 
        };
        
        salaAtiva.jogadores.push(novoJogador);
        socket.join(nomeSala);
        
        // 1. Define quem o jogador recém-conectado é (Envia o objeto completo para bater com o app.js)
        socket.emit('player-assignment', { simbolo: simbolo });

        // 2. Sincroniza as informações de avatares/nomes da sala inteira
        const p1 = salaAtiva.jogadores.find(j => j.simbolo === "X");
        const p2 = salaAtiva.jogadores.find(j => j.simbolo === "O");
        
        io.to(nomeSala).emit('room-info', {
            p1: p1 ? { nome: p1.nome, foto: p1.foto } : null,
            p2: p2 ? { nome: p2.nome, foto: p2.foto } : null
        });

        // 3. Se a sala completou 2 pessoas, inicia a partida
        if (salaAtiva.jogadores.length === 2) {
            io.to(nomeSala).emit('start-game');
        }

        // Atualiza o lobby global de todos os navegadores conectados
        enviarListaSalas();
    });

    // Escuta os movimentos e repassa para o rival na sala correspondente
    socket.on('make-move', (dados) => {
        socket.to(dados.sala).emit('move-made', dados);
    });

    // Evento explícito de desistência/saída por clique de botão
    socket.on('sair-da-sala', (nomeSala) => {
        removerJogadorDeSalas(socket, nomeSala);
    });

    // Gerencia quedas bruscas de conexão, internet ou fechamento de abas
    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
        removerJogadorDeSalas(socket);
    });
});

/**
 * Localiza, limpa o jogador de dentro do escopo de memória do servidor, 
 * notifica o oponente remanescente e atualiza a listagem global.
 */
function removerJogadorDeSalas(socket, nomeSalaEspecifica = null) {
    for (const nomeSala in salas) {
        // Se passamos uma sala específica, pula as outras
        if (nomeSalaEspecifica && nomeSala !== nomeSalaEspecifica) continue;

        const salaAtiva = salas[nomeSala];
        const index = salaAtiva.jogadores.findIndex(j => j.id === socket.id);
        
        if (index !== -1) {
            // Remove o jogador do array interno
            salaAtiva.jogadores.splice(index, 1);
            socket.leave(nomeSala);
            
            // Avisa o rival que ele venceu por W.O. devido ao abandono
            io.to(nomeSala).emit('player-disconnected');
            
            // Destrói a sala caso fique vazia para economizar memória do servidor
            if (salaAtiva.jogadores.length === 0) {
                delete salas[nomeSala];
            } else {
                // Se alguém sobrou, atualiza os dados da sala dele (removendo as infos do que saiu)
                const p1 = salaAtiva.jogadores.find(j => j.simbolo === "X");
                const p2 = salaAtiva.jogadores.find(j => j.simbolo === "O");
                io.to(nomeSala).emit('room-info', {
                    p1: p1 ? { nome: p1.nome, foto: p1.foto } : null,
                    p2: p2 ? { nome: p2.nome, foto: p2.foto } : null
                });
            }

            // Atualiza o lobby geral para sincronizar a mudança de vagas
            enviarListaSalas();
            break;
        }
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando perfeitamente na porta ${PORT}`);
});
