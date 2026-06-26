const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Estrutura das salas estendida para a arquitetura do Hub
// salas[nomeSala] = { 
//    jogadores: [], 
//    espectadores: [], 
//    dimensao: "3", 
//    modo: "classico", 
//    jogo: "velha" 
// }
const salas = {};

// Envia a lista de salas atualizada com suporte ao tipo de jogo e espectadores
function enviarListaSalas() {
    const lista = Object.keys(salas).map(nome => {
        const salaObjeto = salas[nome];
        const jogadores = salaObjeto.jogadores;
        const dono = jogadores[0]; 
        
        return {
            nome: nome,
            jogadores: jogadores.length,
            espectadores: salaObjeto.espectadores ? salaObjeto.espectadores.length : 0,
            dimensao: salaObjeto.dimensao || "3",
            modo: salaObjeto.modo || "classico",
            jogo: salaObjeto.jogo || "velha",
            donoNome: dono ? dono.nome : "Desconhecido",
            donoFoto: dono ? dono.foto : "https://cdn-icons-png.flaticon.com/512/149/149071.png"
        };
    });
    io.emit('lista-salas', lista);
}

io.on('connection', (socket) => {
    console.log(`👤 Conectado à Rede: ${socket.id}`);
    
    enviarListaSalas();

    socket.on('entrar-na-sala', (dados) => {
        const nomeSala = typeof dados === 'object' ? dados.sala : dados;
        const nomeJogador = dados.jogadorNome || "Jogador_Novo";
        let fotoJogador = dados.jogadorFoto || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
        
        // Parâmetros estendidos do Hub
        const dimensaoSala = dados.dimensao || "3";
        const modoSala = dados.modo || "classico";
        const jogoEscolhido = dados.jogo || "velha";

        // 🛡️ TRAVA DE SEGURANÇA CONTRA ULTRA-PAYLOADS (ANTI-ESTOURO DE BUFFER)
        if (fotoJogador.startsWith('data:') && fotoJogador.length > 150000) { 
            console.log(`⚠️ Alerta: Avatar Base64 de "${nomeJogador}" excede limite estável. Reduzindo.`);
            fotoJogador = "https://cdn-icons-png.flaticon.com/512/149/149071.png"; 
        }

        // Inicializa a sala com a nova chave de jogo e array de espectadores
        if (!salas[nomeSala]) {
            salas[nomeSala] = {
                jogadores: [],
                espectadores: [],
                dimensao: dimensaoSala,
                modo: modoSala,
                jogo: jogoEscolhido
            };
        }

        const salaAtual = salas[nomeSala];

        // MOTO DO MODO ESPECTADOR (Ideia 6)
        // Se já existem 2 players ativos, o terceiro entra como telespectador na sala
        if (salaAtual.jogadores.length >= 2) {
            salaAtual.espectadores.push({
                id: socket.id,
                nome: nomeJogador
            });
            
            socket.join(nomeSala);
            socket.emit('player-assignment', 'SPECTATOR');
            
            // Avisa a sala sobre a nova contagem de espectadores
            io.to(nomeSala).emit('spectator-update', salaAtual.espectadores.length);
            
            // Sincroniza o estado atual dos players para o espectador ver
            const infoSala = {
                dimensao: salaAtual.dimensao,
                modo: salaAtual.modo,
                jogo: salaAtual.jogo,
                p1: salaAtual.jogadores[0] ? { nome: salaAtual.jogadores[0].nome, foto: salaAtual.jogadores[0].foto } : null,
                p2: salaAtual.jogadores[1] ? { nome: salaAtual.jogadores[1].nome, foto: salaAtual.jogadores[1].foto } : null
            };
            socket.emit('room-info', infoSala);
            
            enviarListaSalas();
            return;
        }

        // Definição de competidores (X ou O)
        const simbolo = salaAtual.jogadores.length === 0 ? "X" : "O";
        
        salaAtual.jogadores.push({ 
            id: socket.id, 
            simbolo: simbolo, 
            nome: nomeJogador,
            foto: fotoJogador
        });
        
        socket.join(nomeSala);
        socket.emit('player-assignment', simbolo);

        const infoSala = {
            dimensao: salaAtual.dimensao,
            modo: salaAtual.modo,
            jogo: salaAtual.jogo,
            p1: salaAtual.jogadores[0] ? { nome: salaAtual.jogadores[0].nome, foto: salaAtual.jogadores[0].foto } : null,
            p2: salaAtual.jogadores[1] ? { nome: salaAtual.jogadores[1].nome, foto: salaAtual.jogadores[1].foto } : null
        };
        
        setTimeout(() => {
            io.to(nomeSala).emit('room-info', infoSala);
            io.to(nomeSala).emit('spectator-update', salaAtual.espectadores.length);
            
            if (salaAtual.jogadores.length === 2) {
                io.to(nomeSala).emit('start-game');
            }
        }, 60);

        enviarListaSalas();
    });

    // 💬 SISTEMA DE CHAT SEGURO DA SALA (Ideia Integrada)
    socket.on('send-chat-message', (dados) => {
        // Envia para todos da sala, incluindo quem enviou e espectadores
        io.to(dados.sala).emit('receive-chat-message', {
            autor: dados.autor,
            texto: dados.texto,
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // 🎯 EVENTO DE JOGADA TRADICIONAL (Para jogos baseados em Grid como Velha/Xadrez)
    socket.on('make-move', (dados) => {
        socket.to(dados.sala).emit('move-made', dados);
    });

    // 🚀 CANAL DE ALTA VELOCIDADE (Para sincronizar motores gráficos de Canvas em tempo real)
    // Usado para enviar posições x, y da cobrinha, bolinha do pong, tiros, etc.
    socket.on('game-engine-sync', (dados) => {
        socket.to(dados.sala).emit('game-engine-broadcast', dados);
    });

    // 🏅 GERENCIADOR DE RECOMPENSAS GLOBAL
    // Chamado quando o jogo detecta um fim de rodada/partida para dar Bits aos clientes
    socket.on('match-finished', (dados) => {
        // Dispara o evento para o vencedor e perdedor processarem seus Bits localmente
        io.to(dados.sala).emit('distribute-rewards', {
            vencedorSimbolo: dados.vencedorSimbolo, // "X", "O" ou "Empate"
            ganhoBits: dados.modo === 'torneio' ? 300 : 100 // Exemplo de bonificação por modo
        });
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
        const salaAtual = salas[nomeSala];
        
        // Verifica se quem está saindo é um jogador ativo ou um mero espectador
        const eraJogador = salaAtual.jogadores.some(j => j.id === socket.id);

        if (eraJogador) {
            salaAtual.jogadores = salaAtual.jogadores.filter(j => j.id !== socket.id);
            socket.leave(nomeSala);
            
            // Se um jogador desconecta, avisa os outros e encerra ou passa a vitória por W.O.
            io.to(nomeSala).emit('player-disconnected');
        } else if (salaAtual.espectadores) {
            // Se era espectador, apenas remove do array auxiliar
            salaAtual.espectadores = salaAtual.espectadores.filter(e => e.id !== socket.id);
            socket.leave(nomeSala);
            io.to(nomeSala).emit('spectator-update', salaAtual.espectadores.length);
        }
        
        // Se a sala esvaziou totalmente de jogadores reais, deleta da rede
        if (salaAtual.jogadores.length === 0) {
            delete salas[nomeSala];
        } else {
            // Atualiza os painéis informativos para quem sobrou
            const infoSala = {
                dimensao: salaAtual.dimensao,
                modo: salaAtual.modo,
                jogo: salaAtual.jogo,
                p1: salaAtual.jogadores[0] ? { nome: salaAtual.jogadores[0].nome, foto: salaAtual.jogadores[0].foto } : null,
                p2: salaAtual.jogadores[1] ? { nome: salaAtual.jogadores[1].nome, foto: salaAtual.jogadores[1].foto } : null
            };
            io.to(nomeSala).emit('room-info', infoSala);
        }
        enviarListaSalas();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor Hub rodando com sucesso na porta ${PORT}`));
