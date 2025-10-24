const WebSocket = require('ws');
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

// Stockage simple - un seul streamer à la fois
let currentStreamer = null;
const viewers = new Set();

console.log('🚀 Screen Relay Server starting - SINGLE STREAM MODE...');

wss.on('connection', (ws, request) => {
    console.log('🔗 New client connected');
    
    const url = request.url;
    
    if (url.includes('/stream')) {
        // Streamer qui se connecte
        handleStreamerConnection(ws);
    } else if (url.includes('/view')) {
        // Viewer qui se connecte
        handleViewerConnection(ws);
    }

    ws.on('close', () => {
        cleanupConnection(ws);
    });

    ws.on('error', (error) => {
        console.error('💥 WebSocket error:', error);
        cleanupConnection(ws);
    });
});

function handleStreamerConnection(ws) {
    // Remplace le streamer précédent
    if (currentStreamer) {
        currentStreamer.close();
    }
    
    currentStreamer = ws;
    console.log('🎥 New streamer registered');
    
    ws.send(JSON.stringify({ 
        type: 'registered', 
        status: 'success',
        message: 'You are now streaming'
    }));

    // Notifier tous les viewers qu'un nouveau stream est disponible
    viewers.forEach(viewerWs => {
        if (viewerWs.readyState === 1) {
            viewerWs.send(JSON.stringify({
                type: 'stream_available',
                message: 'Stream is live'
            }));
        }
    });
}

function handleViewerConnection(ws) {
    viewers.add(ws);
    console.log(`👀 New viewer connected. Total viewers: ${viewers.size}`);
    
    // Dire au viewer si un stream est disponible
    if (currentStreamer && currentStreamer.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'stream_available',
            message: 'Connected to live stream'
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'no_stream',
            message: 'Waiting for streamer...'
        }));
    }
}

function handleBinaryData(ws, data) {
    // Si c'est le streamer qui envoie des données, les rediriger à tous les viewers
    if (ws === currentStreamer) {
        let viewerCount = 0;
        viewers.forEach(viewerWs => {
            if (viewerWs.readyState === 1) {
                viewerWs.send(data);
                viewerCount++;
            }
        });
        
        if (viewerCount > 0) {
            console.log(`📊 Stream data sent to ${viewerCount} viewers`);
        }
    }
}

function cleanupConnection(ws) {
    if (ws === currentStreamer) {
        currentStreamer = null;
        console.log('🗑️ Streamer disconnected');
        
        // Notifier les viewers
        viewers.forEach(viewerWs => {
            if (viewerWs.readyState === 1) {
                viewerWs.send(JSON.stringify({
                    type: 'stream_ended',
                    message: 'Stream ended'
                }));
            }
        });
    }
    
    viewers.delete(ws);
}

// Gestion des messages (texte et binaire)
wss.on('connection', (ws, request) => {
    const url = request.url;
    
    ws.on('message', (data) => {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data);
                console.log('📨 Message:', message);
            } else {
                // Données binaires (images)
                handleBinaryData(ws, data);
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
        }
    });

    // ... reste du code de connection
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 WebSocket endpoints:`);
    console.log(`   - Streamers: ws://localhost:${PORT}/stream`);
    console.log(`   - Viewers:   ws://localhost:${PORT}/view`);
});

// Nettoyage périodique
setInterval(() => {
    viewers.forEach(ws => {
        if (ws.readyState !== 1) {
            viewers.delete(ws);
        }
    });
    
    console.log(`📈 Stats: ${currentStreamer ? '1 streamer' : 'no streamer'}, ${viewers.size} viewers`);
}, 30000);