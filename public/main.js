'use strict';
const logEl = document.getElementById('log');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const interruptBtn = document.getElementById('interruptBtn');
const langInput = document.getElementById('lang');
const textInputEl = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');

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
let speechUtterance = null;
let micPrewarmRequested = false;

function mapUiLangToLocale(value) {
	switch ((value || '').toLowerCase()) {
		case 'en': return 'en-IN';
		case 'hi': return 'hi-IN';
		case 'hinglish': return 'hi-IN';
		case 'mr': return 'mr-IN';
		case 'bn': return 'bn-IN';
		case 'gu': return 'gu-IN';
		case 'pa': return 'pa-IN';
		case 'ta': return 'ta-IN';
		case 'te': return 'te-IN';
		case 'kn': return 'kn-IN';
		case 'ml': return 'ml-IN';
		default: return 'en-IN';
	}
}


function init() {
    updateButtonStates();
    updateStatusIndicators();
    if (navigator.permissions && navigator.permissions.query) {
        try {
            navigator.permissions.query({ name: 'microphone' }).then((status) => {
                console.log('Microphone permission:', status.state);
            }).catch(() => {});
        } catch (_) {}
    }
    setupMicPermissionPrompt();
}

function setupMicPermissionPrompt() {
    const promptEl = document.getElementById('micPrompt');
    const allowBtn = document.getElementById('micAllowBtn');
    if (!promptEl || !allowBtn) return;
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then((status) => {
            if (status.state === 'granted') {
                promptEl.style.display = 'none';
            } else {
                promptEl.style.display = 'flex';
            }
            status.onchange = () => {
                promptEl.style.display = status.state === 'granted' ? 'none' : 'flex';
            };
        }).catch(() => {
            promptEl.style.display = 'flex';
        });
    } else {
        promptEl.style.display = 'flex';
    }

    allowBtn.onclick = async () => {
        if (micPrewarmRequested) return;
        micPrewarmRequested = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            log('🎙️ Microphone permission granted');
            promptEl.style.display = 'none';
        } catch (err) {
            log('⚠️ Please allow microphone access to use voice chat.');
            console.warn('User denied microphone permission:', err);
            promptEl.style.display = 'flex';
        }
    };
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
    serverStatus.className = `status-dot server ${isConnected ? 'connected' : ''}`;
    geminiStatus.className = `status-dot gemini ${isGeminiConnected ? 'connected' : ''}`;
    micStatus.className = `status-dot mic ${isMicActive ? 'active' : ''}`;
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
            try {
                if (speechSynthesis) {
                    if (speechUtterance) {
                        speechSynthesis.cancel();
                        speechUtterance = null;
                    }
                    speechUtterance = new SpeechSynthesisUtterance(message.text);
                    speechUtterance.lang = mapUiLangToLocale(langInput.value);
                    speechUtterance.onend = () => {
                        isGeminiSpeaking = false;
                        updateButtonStates();
                    };
                    speechSynthesis.speak(speechUtterance);
                }
            } catch (e) {
                console.warn('Speech synthesis failed:', e);
            }
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
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            } 
        });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        const processor = audioContext.createScriptProcessor(2048, 1, 1);
        
        processor.onaudioprocess = (event) => {
            if (isMicActive && ws && ws.readyState === WebSocket.OPEN) {
                const inputBuffer = event.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
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
        
        ws.send(JSON.stringify({ type: 'start_mic', languageCode: (langInput.value || 'en') }));
        
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
        if (speechSynthesis) {
            try { speechSynthesis.cancel(); } catch (e) {}
        }
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


function sendTextMessage() {
    if (!textInputEl) return;
    const text = textInputEl.value.trim();
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text_message', text }));
        textInputEl.value = '';
    } else {
        log('❌ Not connected to server');
    }
}

if (textInputEl) {
    textInputEl.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendTextMessage();
        }
    });
}

if (sendBtn) {
    sendBtn.addEventListener('click', sendTextMessage);
}


