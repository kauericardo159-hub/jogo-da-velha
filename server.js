const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Permite que o seu site no GitHub acesse este servidor com segurança
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let jogadores = [];

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    // Limita a sala a apenas 2 jogadores
    if (jogadores.length < 2) {
        const simbolo = jogadores.length === 0 ? "X" : "O";
        jogadores.push({ id: socket.id, simbolo: simbolo });
        socket.emit('player-assignment', simbolo);

        if (jogadores.length === 2) {
            io.emit('start-game');
        }
    } else {
        socket.emit('status', 'Sala cheia');
        socket.disconnect();
        return;
    }

    // Escuta os movimentos e repassa para o outro jogador
    socket.on('make-move', (dados) => {
        socket.broadcast.emit('move-made', dados);
    });

    // Limpa a sala se alguém desconectar
    socket.on('disconnect', () => {
        jogadores = jogadores.filter(j => j.id !== socket.id);
        io.emit('player-disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
