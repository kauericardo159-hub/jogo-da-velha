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

// Aqui vamos guardar as salas ativas. 
// Estrutura: { "nomeDaSala": [ { id: "socketId", simbolo: "X" } ] }
const salas = {};

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    // O jogador pede para entrar em uma sala
    socket.on('entrar-na-sala', (nomeSala) => {
        // Se a sala não existe, cria uma vazia
        if (!salas[nomeSala]) {
            salas[nomeSala] = [];
        }

        const jogadoresNaSala = salas[nomeSala];

        // Se a sala já tiver 2 jogadores, impede a entrada
        if (jogadoresNaSala.length >= 2) {
            socket.emit('status', 'Sala cheia');
            socket.disconnect();
            return;
        }

        // Define o símbolo com base em quem já está na sala
        // Se não tem ninguém, é X. Se já tem 1, é O.
        const simbolo = jogadoresNaSala.length === 0 ? "X" : "O";
        
        // Guarda as informações do jogador
        jogadoresNaSala.push({ id: socket.id, simbolo: simbolo, sala: nomeSala });
        
        // Faz o socket do navegador entrar oficialmente na "sala" do Socket.io
        socket.join(nomeSala);
        
        // Avisa o jogador qual o símbolo dele
        socket.emit('player-assignment', simbolo);

        // Se completou 2 jogadores, avisa a sala que o jogo começou
        if (jogadoresNaSala.length === 2) {
            io.to(nomeSala).emit('start-game');
        }
    });

    // Escuta os movimentos e repassa APENAS para a sala correta
    socket.on('make-move', (dados) => {
        // Envia para todos na sala, exceto para quem enviou
        socket.to(dados.sala).emit('move-made', dados);
    });

    // Gerencia a desconexão limpando a sala corretamente
    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
        
        // Procura em qual sala esse usuário estava
        for (const nomeSala in salas) {
            const index = salas[nomeSala].findIndex(j => j.id === socket.id);
            
            if (index !== -1) {
                // Remove o jogador da lista daquela sala
                salas[nomeSala].splice(index, 1);
                
                // Avisa o jogador restante que o oponente saiu
                io.to(nomeSala).emit('player-disconnected');
                
                // Se a sala ficou totalmente vazia, deleta ela para não gastar memória
                if (salas[nomeSala].length === 0) {
                    delete salas[nomeSala];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando perfeitamente na porta ${PORT}`);
});
