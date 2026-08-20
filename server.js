const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const salas = {};

// Função auxiliar para enviar a lista de salas atualizada para todo mundo
function enviarListaSalas() {
    const lista = Object.keys(salas).map(nome => ({
        nome: nome,
        jogadores: salas[nome].length
    }));
    io.emit('lista-salas', lista);
}

io.on('connection', (socket) => {
    console.log(`Conectado: ${socket.id}`);
    
    // Envia as salas existentes assim que alguém abre o site
    enviarListaSalas();

    socket.on('entrar-na-sala', (nomeSala) => {
        if (!salas[nomeSala]) {
            salas[nomeSala] = [];
        }

        const jogadoresNaSala = salas[nomeSala];

        if (jogadoresNaSala.length >= 2) {
            socket.emit('status-erro', 'Esta sala já está cheia!');
            return;
        }

        const simbolo = jogadoresNaSala.length === 0 ? "X" : "O";
        jogadoresNaSala.push({ id: socket.id, simbolo: simbolo, pronto: false });
        
        socket.join(nomeSala);
        socket.emit('player-assignment', simbolo);

        if (jogadoresNaSala.length === 2) {
            io.to(nomeSala).emit('start-game');
        }

        enviarListaSalas();
    });

    socket.on('make-move', (dados) => {
        socket.to(dados.sala).emit('move-made', dados);
    });

    socket.on('reiniciar-rodada', (dados) => {
        socket.to(dados.sala).emit('rodada-reiniciada');
    });

    // Quando o jogador clica em "Sair da Sala" ou fecha o navegador
    socket.on('sair-da-sala', (nomeSala) => {
        sair(socket, nomeSala);
    });

    socket.on('disconnect', () => {
        for (const nomeSala in salas) {
            sair(socket, nomeSala);
        }
    });
});

function sair(socket, nomeSala) {
    if (salas[nomeSala]) {
        salas[nomeSala] = salas[nomeSala].filter(j => j.id !== socket.id);
        socket.leave(nomeSala);
        io.to(nomeSala).emit('player-disconnected');
        
        if (salas[nomeSala].length === 0) {
            delete salas[nomeSala];
        }
        enviarListaSalas();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
