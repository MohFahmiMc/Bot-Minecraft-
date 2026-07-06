const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Menggunakan port sesuai spesifikasi VPS Anda
const PORT = 26056;

// Melayani file statis untuk tampilan Web UI
app.use(express.static(path.join(__dirname, 'public')));

let bot = null;
let afkInterval = null;

// Intersepsi console.log agar pesan autentikasi Microsoft muncul di Web Panel
const originalLog = console.log;
console.log = function (...args) {
    originalLog.apply(console, args);
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    io.emit('log', '[ CONSOLE ] ' + message);
};

// Fungsi utama untuk menjalankan Bot Minecraft
function startBot(config) {
    if (bot) {
        io.emit('log', '[ SYSTEM ] Menghentikan bot lama sebelum memuat ulang...');
        bot.quit();
        clearInterval(afkInterval);
    }

    io.emit('log', '[ SYSTEM ] Menghubungkan ke server ' + config.host + ':' + config.port + '...');

    bot = mineflayer.createBot({
        host: config.host,
        port: parseInt(config.port) || 25565,
        username: config.username,
        auth: 'microsoft',
        version: false // Otomatis mendeteksi versi terbaru yang didukung oleh server
    });

    bot.on('login', () => {
        io.emit('status', 'ONLINE');
        io.emit('log', '[ MINECRAFT ] Bot berhasil login menggunakan akun asli.');
    });

    bot.on('spawn', () => {
        io.emit('log', '[ MINECRAFT ] Bot berhasil masuk ke dalam dunia server.');
        
        // Fitur AFK Otomatis (Melompat dan sedikit berputar setiap 30 detik agar tidak terkena kick)
        if (afkInterval) clearInterval(afkInterval);
        afkInterval = setInterval(() => {
            if (bot) {
                bot.setControlState('jump', true);
                setTimeout(() => {
                    if (bot) bot.setControlState('jump', false);
                }, 500);

                if (bot.entity) {
                    const currentYaw = bot.entity.yaw;
                    bot.look(currentYaw + 0.5, bot.entity.pitch);
                }
                io.emit('log', '[ AFK ] Bot melakukan gerakan anti-kick.');
            }
        }, 30000);
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        io.emit('chat-message', { username, message });
    });

    bot.on('disconnect', (reason) => {
        io.emit('status', 'OFFLINE');
        io.emit('log', '[ MINECRAFT ] Bot terputus dari server. Alasan: ' + JSON.stringify(reason));
        clearInterval(afkInterval);
        bot = null;
    });

    bot.on('error', (err) => {
        io.emit('log', '[ ERROR ] Terjadi kesalahan: ' + err.message);
    });
}

// Manajemen WebSocket untuk komunikasi dengan Web Browser
io.on('connection', (socket) => {
    // Kirim status bot saat ini kepada user yang baru membuka web
    socket.emit('status', bot ? 'ONLINE' : 'OFFLINE');

    socket.on('start-bot', (config) => {
        startBot(config);
    });

    socket.on('stop-bot', () => {
        if (bot) {
            bot.quit();
            clearInterval(afkInterval);
            bot = null;
            io.emit('status', 'OFFLINE');
            io.emit('log', '[ SYSTEM ] Bot dimatikan secara manual via kontrol web.');
        }
    });

    socket.on('send-chat', (message) => {
        if (bot) {
            bot.chat(message);
            io.emit('chat-message', { username: 'Anda (Web)', message: message });
        } else {
            socket.emit('log', '[ SYSTEM ] Gagal mengirim pesan. Bot sedang offline.');
        }
    });
});

// Menjalankan server pada IP 0.0.0.0 agar bisa diakses dari luar VPS
server.listen(PORT, '0.0.0.0', () => {
    console.log('[ WEB SERVER ] Panel berjalan di port ' + PORT);
});
