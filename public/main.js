'use strict';
const logEl = document.getElementById('log');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const interruptBtn = document.getElementById('interruptBtn');
const langInput = document.getElementById('lang');

const serverStatus = document.querySelector('.status-dot.server');
const geminiStatus = document.querySelector('.status-dot.gemini');
const micStatus = document.querySelector('.status-dot.mic');


let ws = null;
let mediaStream = null;
let audioContext = null;
let isConnected = false;
let isMicActive = false;
let isGeminiConnected = false;
let isGeminiSpeaking = false;
let currentResponseText = '';


function init() {
    updateButtonStates();
    updateStatusIndicators();
}


function log(line) {
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += `[${timestamp}] ${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}


function updateButtonStates() {
    connectBtn.disabled = isConnected;
    startBtn.disabled = !isConnected || !isGeminiConnected || isMicActive;
    stopBtn.disabled = !isConnected || !isGeminiConnected || !isMicActive;
    interruptBtn.disabled = !isConnected || !isGeminiConnected || !isGeminiSpeaking;
}


function updateStatusIndicators() {
    serverStatus.className = `status-dot server ${isConnected ? 'connected' : 'disconnected'}`;
    geminiStatus.className = `status-dot gemini ${isGeminiConnected ? 'connected' : 'disconnected'}`;
    micStatus.className = `status-dot mic ${isMicActive ? 'active' : 'inactive'}`;
}


function getWsUrl(pathname) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${pathname}`;
}


function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        log('Already connected');
        return;
    }

    log('Connecting to server...');
    
    try {
        ws = new WebSocket(getWsUrl('/ws'));
        
        ws.onopen = () => {
            log('✅ Connected to server');
            isConnected = true;
            updateButtonStates();
            updateStatusIndicators();
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (error) {
                console.error('Error parsing server message:', error);
            }
        };
        
        ws.onclose = (event) => {
            log(`❌ Connection closed: ${event.code} - ${event.reason}`);
            isConnected = false;
            isGeminiConnected = false;
            isMicActive = false;
            isGeminiSpeaking = false;
            updateButtonStates();
            updateStatusIndicators();
        };
        
        ws.onerror = (error) => {
            log('❌ WebSocket error');
            console.error('WebSocket error:', error);
        };
        
    } catch (error) {
        log('❌ Failed to connect');
        console.error('Connection error:', error);
    }
}


function handleServerMessage(message) {
    switch (message.type) {
        case 'connection_status':
            if (message.connected) {
                log('✅ Server connection: OK');
                if (!message.hasApiKey) {
                    log('❌ ⚠️ No API key configured - running in demo mode');
                }
            }
            break;
            
        case 'gemini_status':
            if (message.connected) {
                log(`✅ Gemini connection: OK (${message.model})`);
                isGeminiConnected = true;
            } else {
                log(`❌ Gemini connection: Failed (${message.model})`);
                isGeminiConnected = false;
            }
            updateButtonStates();
            updateStatusIndicators();
            break;
            
        case 'mic_status':
            if (message.started) {
                log('🎤 Microphone started');
                isMicActive = true;
            } else {
                log('🔇 Microphone stopped');
                isMicActive = false;
            }
            updateButtonStates();
            updateStatusIndicators();
            break;
            
        case 'interrupt_ack':
            if (message.interrupted) {
                log('⏹️ Conversation interrupted');
                isGeminiSpeaking = false;
                currentResponseText = '';
                updateButtonStates();
            }
            break;
            
        case 'user_message':
            log(`👤 You: ${message.text}`);
            break;
            
        case 'ai_response':
            log(`🤖 Rev: ${message.text}`);
            isGeminiSpeaking = true;
            currentResponseText = message.text;
            updateButtonStates();
            break;
            
        case 'error':
            log(`❌ Error: ${message.message}`);
            break;
            
        default:
            console.log('Unknown message type:', message.type);
    }
}


async function startMic() {
    if (!isConnected || !isGeminiConnected) {
        log('❌ Not connected to server or Gemini');
        return;
    }
    
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            } 
        });
        
        audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (event) => {
            if (isMicActive && ws && ws.readyState === WebSocket.OPEN) {
                const inputBuffer = event.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                

                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                }

                ws.send(JSON.stringify({
                    type: 'audio_data',
                    audio: Array.from(int16Data),
                    timestamp: Date.now()
                }));
            }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        ws.send(JSON.stringify({ type: 'start_mic' }));
        
    } catch (error) {
        log(`❌ Failed to start microphone: ${error.message}`);
        console.error('Microphone error:', error);
    }
}

function stopMic() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop_mic' }));
    }
}

function interrupt() {
    if (!isConnected || !isGeminiConnected) {
        log('❌ Not connected to server or Gemini');
        return;
    }
    
    if (isGeminiSpeaking) {
        log('⏹️ Interrupting AI response...');
        ws.send(JSON.stringify({ type: 'interrupt' }));
    } else {
        log('ℹ️ No AI response to interrupt');
    }
}

connectBtn.onclick = connect;
startBtn.onclick = startMic;
stopBtn.onclick = stopMic;
interruptBtn.onclick = interrupt;


document.addEventListener('DOMContentLoaded', init);


const textInput = document.createElement('input');
textInput.type = 'text';
textInput.placeholder = 'Type a message to test (Enter to send)';
textInput.style.width = '100%';
textInput.style.padding = '8px';
textInput.style.marginTop = '10px';
textInput.style.borderRadius = '4px';
textInput.style.border = '1px solid #ccc';

textInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && textInput.value.trim()) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'text_message',
                text: textInput.value.trim()
            }));
            textInput.value = '';
        } else {
            log('❌ Not connected to server');
        }
    }
});

logEl.parentNode.insertBefore(textInput, logEl.nextSibling);


