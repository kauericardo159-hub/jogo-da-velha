const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Estrutura das salas:
// {
//   "NomeDaSala": [
//      { id: "socketId", simbolo: "X", nome: "Nick", foto: "base64..." },
//      { id: "socketId", simbolo: "O", nome: "Nick", foto: "base64..." }
//   ]
// }
const salas = {};

// Função auxiliar para enviar a lista de salas atualizada para todo mundo no lobby
function enviarListaSalas() {
    const lista = Object.keys(salas).map(nome => {
        const jogadores = salas[nome];
        // O criador da sala sempre será o primeiro elemento do array (index 0)
        const dono = jogadores[0]; 
        
        return {
            nome: nome,
            jogadores: jogadores.length,
            donoNome: dono ? dono.nome : "Desconhecido",
            donoFoto: dono ? dono.foto : "https://cdn-icons-png.flaticon.com/512/149/149071.png"
        };
    });
    io.emit('lista-salas', lista);
}

io.on('connection', (socket) => {
    console.log(`👤 Conectado: ${socket.id}`);
    
    // Envia as salas existentes assim que alguém abre o site
    enviarListaSalas();

    // Agora recebe um objeto com 'sala', 'jogadorNome' e 'jogadorFoto'
    socket.on('entrar-na-sala', (dados) => {
        // Suporte a fallback caso venha apenas o nome da sala como string pura
        const nomeSala = typeof dados === 'object' ? dados.sala : dados;
        const nomeJogador = dados.jogadorNome || "Jogador_Novo";
        const fotoJogador = dados.jogadorFoto || "https://cdn-icons-png.flaticon.com/512/149/149071.png";

        if (!salas[nomeSala]) {
            salas[nomeSala] = [];
        }

        const jogadoresNaSala = salas[nomeSala];

        if (jogadoresNaSala.length >= 2) {
            socket.emit('status-erro', 'Esta sala já está cheia!');
            return;
        }

        const simbolo = jogadoresNaSala.length === 0 ? "X" : "O";
        
        // Salvamos os dados do perfil dentro do objeto do jogador na sala
        jogadoresNaSala.push({ 
            id: socket.id, 
            simbolo: simbolo, 
            nome: nomeJogador,
            foto: fotoJogador
        });
        
        socket.join(nomeSala);
        
        // Avisa o jogador qual o símbolo dele
        socket.emit('player-assignment', simbolo);

        // Dispara os dados dos perfis de quem está dentro da sala (para desenhar no placar)
        const infoSala = {
            p1: jogadoresNaSala[0] ? { nome: jogadoresNaSala[0].nome, foto: jogadoresNaSala[0].foto } : null,
            p2: jogadoresNaSala[1] ? { nome: jogadoresNaSala[1].nome, foto: jogadoresNaSala[1].foto } : null
        };
        io.to(nomeSala).emit('room-info', infoSala);

        // Se a sala completou 2 jogadores, inicia o game
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
        } else {
            // Se o dono saiu mas sobrou 1 jogador, atualiza os dados da sala para o restante
            const jogadoresRestantes = salas[nomeSala];
            const infoSala = {
                p1: jogadoresRestantes[0] ? { nome: jogadoresRestantes[0].nome, foto: jogadoresRestantes[0].foto } : null,
                p2: jogadoresRestantes[1] ? { nome: jogadoresRestantes[1].nome, foto: jogadoresRestantes[1].foto } : null
            };
            io.to(nomeSala).emit('room-info', infoSala);
        }
        enviarListaSalas();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
