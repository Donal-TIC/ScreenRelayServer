const WebSocket = require('ws');
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

// Stockage des connexions
const streams = new Map();    // deviceId -> WebSocket (streamers)
const viewers = new Map();    // WebSocket -> targetDeviceId (viewers)

console.log('🚀 Screen Relay Server starting...');

wss.on('connection', (ws, request) => {
    console.log('🔗 New client connected');
    
    // Déterminer le type de client basé sur l'URL
    const url = request.url;
    let clientType = 'unknown';
    
    if (url.includes('/stream')) {
        clientType = 'streamer';
    } else if (url.includes('/view')) {
        clientType = 'viewer';
    }
    
    console.log(`📱 Client type: ${clientType}`);

    ws.on('message', (data) => {
        try {
            if (typeof data === 'string') {
                // Message texte JSON
                const message = JSON.parse(data);
                handleTextMessage(ws, message, clientType);
            } else {
                // Données binaires (images)
                handleBinaryData(ws, data);
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('🔌 Client disconnected');
        cleanupConnection(ws, clientType);
    });

    ws.on('error', (error) => {
        console.error('💥 WebSocket error:', error);
        cleanupConnection(ws, clientType);
    });

    // Accuser réception de la connexion
    ws.send(JSON.stringify({ 
        type: 'connected', 
        status: 'ok',
        clientType: clientType 
    }));
});

function handleTextMessage(ws, message, clientType) {
    console.log(`📨 Received message from ${clientType}:`, message.type);

    switch (message.type) {
        case 'register':
            if (clientType === 'streamer' && message.deviceId) {
                // Un streamer s'enregistre
                streams.set(message.deviceId, ws);
                console.log(`🎥 Streamer registered: ${message.deviceId}`);
                ws.send(JSON.stringify({ 
                    type: 'registered', 
                    status: 'success',
                    deviceId: message.deviceId 
                }));
            }
            break;

        case 'view':
            if (clientType === 'viewer' && message.targetDevice) {
                // Un viewer demande un stream spécifique
                viewers.set(ws, message.targetDevice);
                console.log(`👀 Viewer wants to watch: ${message.targetDevice}`);

                // Vérifier si le stream existe
                const streamerWs = streams.get(message.targetDevice);
                if (streamerWs && streamerWs.readyState === 1) {
                    ws.send(JSON.stringify({ 
                        type: 'stream_available', 
                        status: 'ok',
                        targetDevice: message.targetDevice 
                    }));
                    console.log(`✅ Stream available for viewer`);
                } else {
                    ws.send(JSON.stringify({ 
                        type: 'no_stream', 
                        status: 'error',
                        message: 'Stream not available' 
                    }));
                    console.log(`❌ Stream not available: ${message.targetDevice}`);
                }
            }
            break;

        default:
            console.log('🤷 Unknown message type:', message.type);
    }
}

function handleBinaryData(ws, data) {
    // Trouver quel streamer envoie les données
    let streamerDeviceId = null;
    for (const [deviceId, streamWs] of streams.entries()) {
        if (streamWs === ws) {
            streamerDeviceId = deviceId;
            break;
        }
    }

    if (streamerDeviceId) {
        // Rediriger les données à tous les viewers de ce streamer
        let viewerCount = 0;
        viewers.forEach((targetDeviceId, viewerWs) => {
            if (targetDeviceId === streamerDeviceId && viewerWs.readyState === 1) {
                viewerWs.send(data);
                viewerCount++;
            }
        });
        
        if (viewerCount > 0) {
            console.log(`📊 Stream data sent to ${viewerCount} viewers`);
        }
    }
}

function cleanupConnection(ws, clientType) {
    if (clientType === 'streamer') {
        // Supprimer des streams
        for (const [deviceId, streamWs] of streams.entries()) {
            if (streamWs === ws) {
                streams.delete(deviceId);
                console.log(`🗑️ Streamer removed: ${deviceId}`);
                
                // Notifier les viewers
                notifyViewersStreamEnded(deviceId);
                break;
            }
        }
    } else if (clientType === 'viewer') {
        // Supprimer des viewers
        viewers.delete(ws);
        console.log('🗑️ Viewer removed');
    }
}

function notifyViewersStreamEnded(deviceId) {
    viewers.forEach((targetDeviceId, viewerWs) => {
        if (targetDeviceId === deviceId && viewerWs.readyState === 1) {
            viewerWs.send(JSON.stringify({
                type: 'stream_ended',
                message: 'Stream has ended'
            }));
        }
    });
}

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 WebSocket endpoints:`);
    console.log(`   - Streamers: ws://localhost:${PORT}/stream`);
    console.log(`   - Viewers:   ws://localhost:${PORT}/view`);
});

// Nettoyer les connexions mortes périodiquement
setInterval(() => {
    const now = Date.now();
    
    // Nettoyer les streams
    streams.forEach((ws, deviceId) => {
        if (ws.readyState !== 1) {
            streams.delete(deviceId);
            console.log(`🧹 Cleaned up dead stream: ${deviceId}`);
        }
    });
    
    // Nettoyer les viewers
    viewers.forEach((targetDeviceId, ws) => {
        if (ws.readyState !== 1) {
            viewers.delete(ws);
            console.log('🧹 Cleaned up dead viewer');
        }
    });
    
    console.log(`📈 Stats: ${streams.size} streams, ${viewers.size} viewers`);
}, 30000); // Toutes les 30 secondes