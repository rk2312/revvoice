const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const WebSocket = require('ws');

let universalFetch = globalThis.fetch;
if (!universalFetch) {
	try {
		universalFetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
	} catch (e) {
		console.warn('Fetch API not available and node-fetch not installed. API calls may fail.');
	}
}

dotenv.config();

const app = express();
app.use(compression());
app.use(cors());

app.use((req, res, next) => {
	res.setHeader('Permissions-Policy', 'microphone=(self)');
	next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws' });

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
	console.error('Missing GOOGLE_API_KEY in environment');
	console.error('Please add your API key to .env file');
}

const activeConversations = new Map();

async function callGeminiAPI(prompt, conversationHistory = [], { abortController, uiLanguage } = {}) {
	try {
		console.log('Calling Gemini API with prompt:', prompt);
		console.log('Conversation history length:', conversationHistory.length);
		const contents = [];
		const systemInstruction = {
			parts: [
				{
					text: `You are Rev, an assistant that only talks about Revolt Motors. Politely refuse unrelated questions and bring the conversation back to Revolt bikes, pricing, range, charging, servicing, test rides, locations, financing, and ownership. Keep responses concise and conversational.${uiLanguage ? " Respond in " + uiLanguage + "." : ''}`
				}
			]
		};

		const recentHistory = conversationHistory.slice(-10);
		recentHistory.forEach(msg => {
			contents.push({
				parts: [{ text: msg.text }],
				role: msg.role
			});
		});
		contents.push({
			parts: [{ text: prompt }],
			role: 'user'
		});

		const requestBody = { system_instruction: systemInstruction, contents };
		console.log('Request body:', JSON.stringify(requestBody, null, 2));

		const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
		console.log('Calling API URL:', apiUrl);

		const response = await (universalFetch || fetch)(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
			signal: abortController?.signal
		});

		console.log('Response status:', response.status);
		console.log('Response headers:', response.headers);

		if (!response.ok) {
			const errorText = await response.text();
			console.error('API Error Response:', errorText);
			throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
		}

		const data = await response.json();
		console.log('API Response data:', JSON.stringify(data, null, 2));

		if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
			console.error('Unexpected API response structure:', data);
			throw new Error('Invalid API response structure');
		}

		const responseText = data.candidates[0].content.parts[0].text;
		console.log('Extracted response text:', responseText);
		
		return responseText;
	} catch (error) {
		console.error('Error calling Gemini API:', error);
		console.error('Error stack:', error.stack);
		return `Sorry, I encountered an error: ${error.message}. Please try again.`;
	}
}

function encodeWavFromPCM16(int16Array, sampleRate = 16000) {
	const numFrames = int16Array.length;
	const bytesPerSample = 2;
	const blockAlign = bytesPerSample * 1;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numFrames * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataSize);
	let offset = 0;

	buffer.write('RIFF', offset); offset += 4;
	buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
	buffer.write('WAVE', offset); offset += 4;
	buffer.write('fmt ', offset); offset += 4;
	buffer.writeUInt32LE(16, offset); offset += 4;
	buffer.writeUInt16LE(1, offset); offset += 2;
	buffer.writeUInt16LE(1, offset); offset += 2;
	buffer.writeUInt32LE(sampleRate, offset); offset += 4;
	buffer.writeUInt32LE(byteRate, offset); offset += 4;
	buffer.writeUInt16LE(blockAlign, offset); offset += 2;
	buffer.writeUInt16LE(16, offset); offset += 2;
	buffer.write('data', offset); offset += 4;
	buffer.writeUInt32LE(dataSize, offset); offset += 4;

	for (let i = 0; i < int16Array.length; i++) {
		buffer.writeInt16LE(int16Array[i], offset);
		offset += 2;
	}
	return buffer;
}

async function processAudioToText(audioInt16, { conversationHistory = [], languageCode = 'en-IN', abortController } = {}) {
	try {
		const wavBuffer = encodeWavFromPCM16(Int16Array.from(audioInt16), 16000);
		const base64 = wavBuffer.toString('base64');

		const contents = [];
		const systemInstruction = {
			parts: [
				{
					text: `You are Rev, an assistant that only talks about Revolt Motors. Politely refuse unrelated questions and bring the conversation back to Revolt bikes, pricing, range, charging, servicing, test rides, locations, financing, and ownership. Respond in ${languageCode === 'hinglish' ? 'a mix of Hindi and English (Hinglish)' : languageCode}. Keep responses concise and conversational.`
				}
			]
		};

		const recentHistory = conversationHistory.slice(-10);
		recentHistory.forEach(msg => {
			if (!msg || !msg.text) return;
			const role = msg.role === 'model' ? 'model' : 'user';
			contents.push({
				role,
				parts: [{ text: msg.text }]
			});
		});
		recentHistory.forEach(msg => {
			if (!msg || !msg.text) return;
			const role = msg.role === 'model' ? 'model' : 'user';
			contents.push({
				role,
				parts: [{ text: msg.text }]
			});
		});

		contents.push({
			role: 'user',
			parts: [
				{ inline_data: { mime_type: 'audio/wav', data: base64 } }
			]
		});

		const requestBody = { system_instruction: systemInstruction, contents };
		const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
		const response = await (universalFetch || fetch)(apiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody),
			signal: abortController?.signal
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		const data = await response.json();
		const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!responseText) {
			throw new Error('No text found in AI response');
		}
		return responseText;
	} catch (error) {
		console.error('Audio->Text processing error:', error);
		return `Sorry, I could not process the audio: ${error.message}`;
	}
}

wss.on('connection', (clientWs) => {
	console.log('Client WebSocket connected');
	const clientId = Date.now().toString();
	activeConversations.set(clientId, {
		conversationHistory: [],
		isSpeaking: false,
		currentResponse: null,
		audioBuffer: [],
		languageCode: 'en-IN',
		abortController: null
	});

	clientWs.send(JSON.stringify({
		type: 'connection_status',
		connected: true,
		hasApiKey: !!GOOGLE_API_KEY
	}));

	if (!GOOGLE_API_KEY) {
		clientWs.send(JSON.stringify({
			type: 'error',
			message: 'Server misconfigured: missing GOOGLE_API_KEY. Please add your API key to .env file.'
		}));
		return;
	}

	clientWs.send(JSON.stringify({
		type: 'gemini_status',
		connected: true,
		model: GEMINI_MODEL
	}));

	clientWs.on('message', async (data) => {
		try {
			const message = JSON.parse(data.toString());
			const conversation = activeConversations.get(clientId);
			
			console.log('Client message:', message.type);

			switch (message.type) {
				case 'start_mic':
					conversation.isSpeaking = true;
					conversation.audioBuffer = [];
					if (typeof message.languageCode === 'string' && message.languageCode.trim()) {
						conversation.languageCode = message.languageCode.trim();
					}
					clientWs.send(JSON.stringify({
						type: 'mic_status',
						started: true
					}));
					console.log('Microphone started');
					break;
					
				case 'stop_mic':
					if (conversation.isSpeaking) {
						conversation.isSpeaking = false;

						if (conversation.audioBuffer.length > 0) {
							console.log('Processing audio data...');

							if (conversation.abortController) {
								try { conversation.abortController.abort(); } catch (e) {}
							}
							conversation.abortController = new AbortController();

							const userText = await processAudioToText(conversation.audioBuffer, {
								conversationHistory: conversation.conversationHistory,
								languageCode: conversation.languageCode,
								abortController: conversation.abortController
							});

							conversation.conversationHistory.push({
								role: 'user',
								text: userText
							});
							clientWs.send(JSON.stringify({
								type: 'user_message',
								text: userText
							}));

							console.log('Getting AI response...');
							const aiResponse = await callGeminiAPI(userText, conversation.conversationHistory, { abortController: conversation.abortController, uiLanguage: conversation.languageCode });

							conversation.conversationHistory.push({
								role: 'model',
								text: aiResponse
							});

							clientWs.send(JSON.stringify({
								type: 'ai_response',
								text: aiResponse
							}));
							
							console.log('AI response sent');
						}
						
						clientWs.send(JSON.stringify({
							type: 'mic_status',
							started: false
						}));
					}
					break;
					
				case 'interrupt':
					conversation.isSpeaking = false;
					conversation.audioBuffer = [];
					if (conversation.abortController) {
						try { conversation.abortController.abort(); } catch (e) {}
					}
					clientWs.send(JSON.stringify({
						type: 'interrupt_ack',
						interrupted: true
					}));
					clientWs.send(JSON.stringify({
						type: 'mic_status',
						started: false
					}));
					console.log('Conversation interrupted');
					break;
					
				case 'audio_data':
					if (conversation.isSpeaking && message.audio && Array.isArray(message.audio)) {
						conversation.audioBuffer.push(...message.audio);
					}
					break;
					
				case 'text_message':
					if (message.text) {
						console.log('Processing text message:', message.text);
						conversation.conversationHistory.push({
							role: 'user',
							text: message.text
						});

						clientWs.send(JSON.stringify({
							type: 'user_message',
							text: message.text
						}));
						
						console.log('Calling Gemini API for text message...');
						if (conversation.abortController) {
							try { conversation.abortController.abort(); } catch (e) {}
						}
						conversation.abortController = new AbortController();
						const response = await callGeminiAPI(message.text, conversation.conversationHistory, { abortController: conversation.abortController, uiLanguage: conversation.languageCode });
						
						conversation.conversationHistory.push({
							role: 'model',
							text: response
						});
						clientWs.send(JSON.stringify({
							type: 'ai_response',
							text: response
						}));
						
						console.log('Text message response sent');
					}
					break;
					
				default:
					console.log('Unknown message type:', message.type);
			}
		} catch (error) {
			console.error('Error parsing client message:', error);
			clientWs.send(JSON.stringify({
				type: 'error',
				message: `Server error: ${error.message}`
			}));
		}
	});

	clientWs.on('close', (code, reason) => {
		console.log('Client WebSocket closed:', code, reason);
		activeConversations.delete(clientId);
	});

	clientWs.on('error', (error) => {
		console.error('Client WebSocket error:', error);
	});
});

const basePort = Number(process.env.PORT || 3000);
const candidatePorts = Array.from({ length: 10 }, (_, i) => basePort + i);

function attemptListen(ports) {
	if (ports.length === 0) {
		console.error('No available ports to bind the server.');
		process.exit(1);
	}
	const p = ports[0];
	server.once('error', (err) => {
		if (err && err.code === 'EADDRINUSE') {
			console.warn(`Port ${p} is in use. Trying next port...`);
			return attemptListen(ports.slice(1));
		}
		console.error('Server failed to start:', err);
		process.exit(1);
	});
	server.listen(p, () => {
		console.log(`Server listening on http://localhost:${p}`);
		console.log(`WebSocket available at ws://localhost:${p}/ws`);
		if (!GOOGLE_API_KEY) {
			console.log('⚠️  WARNING: GOOGLE_API_KEY not set. Frontend will work in demo mode.');
		} else {
			console.log('✅ Gemini REST API configured with API key');
			console.log(`📡 Using model: ${GEMINI_MODEL}`);
			console.log('🔗 API endpoint: generativelanguage.googleapis.com/v1beta/models');
			console.log('🎤 Voice chat with interrupt functionality ready!');
			console.log('🔑 API Key (first 10 chars):', GOOGLE_API_KEY.substring(0, 10) + '...');
		}
	});
}

attemptListen(candidatePorts);


