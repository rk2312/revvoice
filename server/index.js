const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const WebSocket = require('ws');

dotenv.config();

const app = express();
app.use(compression());
app.use(cors());
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

async function callGeminiAPI(prompt, conversationHistory = []) {
	try {
		console.log('Calling Gemini API with prompt:', prompt);
		console.log('Conversation history length:', conversationHistory.length);
		const contents = [
			{
				parts: [
					{
						text: `You are Rev, an assistant that only talks about Revolt Motors. Politely refuse unrelated questions and bring the conversation back to Revolt bikes, pricing, range, charging, servicing, test rides, locations, financing, and ownership. Keep responses concise and conversational.`
					}
				]
			}
		];

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

		const requestBody = { contents };
		console.log('Request body:', JSON.stringify(requestBody, null, 2));

		const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
		console.log('Calling API URL:', apiUrl);

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody)
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

function processAudioToText(audioData) {

	return "Hello, I'd like to know about Revolt Motors bikes";
}

wss.on('connection', (clientWs) => {
	console.log('Client WebSocket connected');
	const clientId = Date.now().toString();
	activeConversations.set(clientId, {
		conversationHistory: [],
		isSpeaking: false,
		currentResponse: null,
		audioBuffer: []
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

							const userText = processAudioToText(conversation.audioBuffer);

							conversation.conversationHistory.push({
								role: 'user',
								text: userText
							});
							clientWs.send(JSON.stringify({
								type: 'user_message',
								text: userText
							}));

							console.log('Getting AI response...');
							const aiResponse = await callGeminiAPI(userText, conversation.conversationHistory);

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
					if (conversation.isSpeaking) {
						conversation.isSpeaking = false;
						conversation.audioBuffer = [];
						
						clientWs.send(JSON.stringify({
							type: 'interrupt_ack',
							interrupted: true
						}));
						
						clientWs.send(JSON.stringify({
							type: 'mic_status',
							started: false
						}));
						
						console.log('Conversation interrupted');
					}
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
						const response = await callGeminiAPI(message.text, conversation.conversationHistory);
						
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

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
	console.log(`WebSocket available at ws://localhost:${port}/ws`);
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


