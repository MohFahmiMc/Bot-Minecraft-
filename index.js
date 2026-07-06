const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bedrock = require('bedrock-protocol');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Konfigurasi Port VPS dan Proteksi Password Web
const PORT = 26056;
const WEB_PASSWORD = "1512011";

app.use(express.static(path.join(__dirname, 'public')));

let bot = null;
let runtimeEntityId = null;
let afkInterval = null;

// Intersepsi console.log untuk menyalurkan data login Microsoft ke Web UI
const originalLog = console.log;
console.log = function (...args) {
    originalLog.apply(console, args);
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    io.emit('log', '[ CONSOLE ] ' + message);
};

function startBot(config) {
    if (bot) {
        io.emit('log', '[ SYSTEM ] Mematikan bot aktif sebelumnya...');
        try { bot.close(); } catch (e) {}
        clearInterval(afkInterval);
    }

    io.emit('log', '[ SYSTEM ] Menghubungkan ke server Bedrock/MCPE: ' + config.host + ':' + config.port);
    io.emit('status', 'JOINING');

    try {
        // bedrock-protocol secara otomatis menyimpan data auth token di folder khusus 
        // sehingga user tidak perlu melakukan verifikasi ulang pada peluncuran berikutnya
        bot = bedrock.createClient({
            host: config.host,
            port: parseInt(config.port) || 19132,
            username: config.username,
            offline: false,
            profilesFolder: path.join(__dirname, 'auth_cache')
        });

        bot.on('start_game', (packet) => {
            runtimeEntityId = packet.runtime_entity_id;
            io.emit('status', 'ONLINE');
            io.emit('log', '[ MINECRAFT ] Sukses bergabung! Bot berhasil memuat map dunia.');

            // Mekanisme anti-kick server / AFK loop rutin
            if (afkInterval) clearInterval(afkInterval);
            afkInterval = setInterval(() => {
                if (bot && runtimeEntityId) {
                    bot.queue('animate', {
                        action_id: 1,
                        runtime_entity_id: runtimeEntityId
                    });
                    io.emit('log', '[ AFK ] Bot melakukan pergerakan kecil (Anti-Kick).');
                }
            }, 30000);
        });

        bot.on('text', (packet) => {
            // Membaca chat global, chat sistem, maupun bisikan player lain
            if (packet.message) {
                const sender = packet.source_name || 'SERVER/SYSTEM';
                io.emit('chat-message', { username: sender, message: packet.message });
            }
        });

        bot.on('close', () => {
            io.emit('status', 'OFFLINE');
            io.emit('log', '[ MINECRAFT ] Koneksi terputus dari server target.');
            clearInterval(afkInterval);
            bot = null;
            runtimeEntityId = null;
        });

        bot.on('error', (err) => {
            io.emit('log', '[ ERROR ] Hubungan terganggu: ' + err.message);
        });

    } catch (err) {
        io.emit('log', '[ ERROR INITIALIZATION ] Gagal memproses: ' + err.message);
    }
}

io.on('connection', (socket) => {
    let clientAuthenticated = false;

    // Sistem verifikasi password panel web sebelum akses diberikan
    socket.on('verify-password', (inputPass) => {
        if (inputPass === WEB_PASSWORD) {
            clientAuthenticated = true;
            socket.emit('auth-result', { success: true });
            socket.emit('status', bot ? 'ONLINE' : (bot ? 'JOINING' : 'OFFLINE'));
        } else {
            socket.emit('auth-result', { success: false, msg: 'Password salah!' });
        }
    });

    socket.on('start-bot', (config) => {
        if (!clientAuthenticated) return;
        startBot(config);
    });

    socket.on('stop-bot', () => {
        if (!clientAuthenticated) return;
        if (bot) {
            try { bot.close(); } catch (e) {}
            clearInterval(afkInterval);
            bot = null;
            runtimeEntityId = null;
            io.emit('status', 'OFFLINE');
            io.emit('log', '[ SYSTEM ] Bot diputus paksa dari panel.');
        }
    });

    socket.on('logout-session', () => {
        if (!clientAuthenticated) return;
        if (bot) {
            try { bot.close(); } catch (e) {}
            bot = null;
        }
        // Menghapus folder auth token agar user bisa mengganti akun Microsoft
        const cacheDir = path.join(__dirname, 'auth_cache');
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            io.emit('log', '[ SYSTEM ] Session cache dihapus. Silakan lakukan proses login ulang.');
        } else {
            io.emit('log', '[ SYSTEM ] Session cache kosong.');
        }
        io.emit('status', 'OFFLINE');
    });

    socket.on('send-chat', (msg) => {
        if (!clientAuthenticated || !bot) return;
        
        if (msg.startsWith('/')) {
            // Mengirimkan perintah Command ke server MCPE
            bot.queue('command_request', {
                command: msg,
                origin: { type: 0, uuid: bot.uuid || '', request_id: 'vps_bot_cmd' },
                internal: false,
                version: 52
            });
            io.emit('log', '[ COMMAND ] Eksekusi perintah: ' + msg);
        } else {
            // Mengirimkan chat biasa ke server MCPE
            bot.queue('text', {
                type: 'chat',
                needs_translation: false,
                source_name: bot.username || '',
                xuid: '',
                platform_chat_id: '',
                message: msg
            });
            io.emit('chat-message', { username: 'Anda (Web)', message: msg });
        }
    });

    // Simulasi klik kiri (Pukul / Hancurkan)
    socket.on('action-left-click', () => {
        if (!clientAuthenticated || !bot || !runtimeEntityId) return;
        bot.queue('animate', {
            action_id: 1,
            runtime_entity_id: runtimeEntityId
        });
        io.emit('log', '[ INDIKASI ] Menjalankan interaksi klik kiri (Swing).');
    });

    // Simulasi klik kanan (Gunakan Item / Lempar Pancingan)
    socket.on('action-right-click', () => {
        if (!clientAuthenticated || !bot) return;
        bot.queue('use_item', {
            action_type: 0,
            block_position: { x: 0, y: 0, z: 0 },
            face: -1,
            hotbar_slot: 0,
            held_item: { network_id: 0 },
            player_position: { x: 0, y: 0, z: 0 },
            click_position: { x: 0, y: 0, z: 0 },
            block_runtime_id: 0
        });
        io.emit('log', '[ INDIKASI ] Menjalankan interaksi klik kanan (Gunakan Item/Mancing).');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('[ SERVER ] Panel berjalan pada port ' + PORT);
});
