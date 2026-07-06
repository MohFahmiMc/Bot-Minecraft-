// ====================================================================
// ULTRA PROTECTION: FORCE PURE JAVASCRIPT BACKEND
// Memaksa bedrock-protocol beralih ke engine JS murni agar bypass biner aman
// dan proses Login Microsoft Premium tidak mengalami crash constructor.
// ====================================================================
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'raknet-native') {
        const err = new Error("Cannot find module 'raknet-native'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    return originalLoad.apply(this, arguments);
};
// ====================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bedrock = require('bedrock-protocol');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// OTOMATIS: Membaca Port Publik berapapun yang diberikan oleh bot-hosting.net / VPS kamu
const PORT = process.env.SERVER_PORT || process.env.PORT || 26056;
const WEB_PASSWORD = "1512011";

app.use(express.static(path.join(__dirname, 'public')));

let bot = null;
let runtimeEntityId = null;
let afkInterval = null;

// Salurkan log console standard ke Web UI
const originalLog = console.log;
console.log = function (...args) {
    originalLog.apply(console, args);
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    io.emit('log', '[ CONSOLE ] ' + message);
};

function startBot(config) {
    if (bot) {
        io.emit('log', '[ SYSTEM ] Mematikan instansi bot sebelumnya...');
        try { bot.close(); } catch (e) {}
        clearInterval(afkInterval);
    }

    io.emit('log', '[ SYSTEM ] Menghubungkan ke server MCPE: ' + config.host + ':' + config.port);
    io.emit('status', 'JOINING');

    try {
        // LOGIN MICROSOFT PREMIUM RESMI (offline: false)
        bot = bedrock.createClient({
            host: config.host,
            port: parseInt(config.port) || 19132,
            username: config.username, 
            offline: false, // WAJIB FALSE AGAR LOGIN AKUN MICROSOFT AKURAT
            profilesFolder: path.join(__dirname, 'auth_cache'),
            raknetBackend: 'js',
            
            // MENANGKAP KODE OTP MICROSOFT SECARA OTOMATIS DAN AKURAT
            onMsaCode: (data) => {
                io.emit('microsoft-auth-code', {
                    code: data.userCode,
                    url: data.verificationUri,
                    message: data.message
                });
                io.emit('log', '[ MICROSOFT ] Menunggu verifikasi perangkat... Kode OTP telah dikirim ke Web UI!');
            }
        });

        bot.on('start_game', (packet) => {
            runtimeEntityId = packet.runtime_entity_id;
            io.emit('status', 'ONLINE');
            io.emit('log', '[ MINECRAFT ] Sukses! Bot Premium berhasil masuk ke dalam game server.');
            io.emit('microsoft-auth-success', true); // Sembunyikan form OTP di web jika sukses

            // Loop Anti-Kick 30 detik
            if (afkInterval) clearInterval(afkInterval);
            afkInterval = setInterval(() => {
                if (bot && runtimeEntityId) {
                    bot.queue('animate', {
                        action_id: 1,
                        runtime_entity_id: runtimeEntityId
                    });
                    io.emit('log', '[ AFK ] Bot melakukan pergerakan anti-kick.');
                }
            }, 30000);
        });

        bot.on('text', (packet) => {
            if (packet.message) {
                const sender = packet.source_name || 'SERVER';
                io.emit('chat-message', { username: sender, message: packet.message });
            }
        });

        bot.on('close', () => {
            io.emit('status', 'OFFLINE');
            io.emit('log', '[ MINECRAFT ] Koneksi bot terputus.');
            clearInterval(afkInterval);
            bot = null;
            runtimeEntityId = null;
        });

        bot.on('error', (err) => {
            io.emit('log', '[ ERROR ] Masalah Jaringan: ' + err.message);
        });

    } catch (err) {
        io.emit('log', '[ INITIALIZATION ERROR ] Gagal memicu client: ' + err.message);
    }
}

io.on('connection', (socket) => {
    let clientAuthenticated = false;

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
            io.emit('log', '[ SYSTEM ] Bot dimatikan dari panel.');
        }
    });

    socket.on('logout-session', () => {
        if (!clientAuthenticated) return;
        if (bot) {
            try { bot.close(); } catch (e) {}
            bot = null;
        }
        const cacheDir = path.join(__dirname, 'auth_cache');
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            io.emit('log', '[ SYSTEM ] Cache login dihapus. Silakan login ulang.');
        }
        io.emit('status', 'OFFLINE');
    });

    socket.on('send-chat', (msg) => {
        if (!clientAuthenticated || !bot) return;
        
        if (msg.startsWith('/')) {
            bot.queue('command_request', {
                command: msg,
                origin: { type: 0, uuid: bot.uuid || '', request_id: 'vps_bot_cmd' },
                internal: false,
                version: 52
            });
            io.emit('log', '[ COMMAND ] Menjalankan perintah: ' + msg);
        } else {
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

    socket.on('action-left-click', () => {
        if (!clientAuthenticated || !bot || !runtimeEntityId) return;
        bot.queue('animate', {
            action_id: 1,
            runtime_entity_id: runtimeEntityId
        });
        io.emit('log', '[ KONTROL ] Klik Kiri (Swing).');
    });

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
        io.emit('log', '[ KONTROL ] Klik Kanan (Mancing / Gunakan Item).');
    });
});

// MEMBUKA LOGIKAL IP KE ALL INTERFACES (0.0.0.0) BIAR BISA DIAKSES VIA IP VPS PUBLIK MANAPUN
server.listen(PORT, '0.0.0.0', () => {
    console.log('[ VPS SERVER ] Web Panel Aktif!');
    console.log('[ VPS SERVER ] Akses menggunakan IP VPS Anda dengan Port: ' + PORT);
});
