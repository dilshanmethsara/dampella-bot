const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const admin = require('firebase-admin');
require('dotenv').config();

// 1. Initialize Firebase Admin
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized.');
} catch (error) {
    console.error('Error initializing Firebase:', error.message);
    console.log('Ensure FIREBASE_SERVICE_ACCOUNT is set in your environment.');
}

const db = admin.firestore();

// 2. Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "dampella-bot-main"
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Helps with low-RAM VPS
            '--disable-gpu'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1037444161-alpha.html',
    }
});

// QR Code generation
client.on('qr', (qr) => {
    console.log('--- QR CODE RECEIVED ---');
    console.log('Scan this with your WhatsApp to login:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('--- WHATSAPP BOT IS READY ---');
    console.log('Monitoring: Announcements, Quizzes, and Assignments...');
    
    // Start all listeners
    startCollectionListener('announcements', sendAnnouncementToWhatsApp);
    startCollectionListener('assignments', sendAssignmentToWhatsApp);
    startCollectionListener('quizzes', sendQuizToWhatsApp);
});

// Command to help user find Group ID
client.on('message_create', async msg => {
    if (msg.body === '!getid') {
        const chat = await msg.getChat();
        msg.reply(`The ID for this ${chat.isGroup ? 'group' : 'chat'} is:\n${chat.id._serialized}`);
        console.log(`ID Request from ${chat.name}: ${chat.id._serialized}`);
    }
});

// --- HELPER FUNCTIONS ---

// Generic listener for any collection
function startCollectionListener(collectionName, callback) {
    console.log(`--- [${collectionName.toUpperCase()}] LISTENER STARTED ---`);
    const ref = db.collection(collectionName);
    let isInitialLoad = true;

    ref.onSnapshot(snapshot => {
        if (isInitialLoad) {
            console.log(`[${collectionName}] Initial load complete. Ignored ${snapshot.size} existing items.`);
            isInitialLoad = false;
            return;
        }

        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                console.log(`[${collectionName}] NEW entry detected:`, data.title || 'No Title');
                callback(data);
            }
        });
    }, err => console.error(`[${collectionName}] listener error:`, err));
}

// Fetch teacher name from profiles collection
async function getTeacherName(email) {
    if (!email) return 'A Teacher';
    try {
        const profilesRef = db.collection('profiles');
        const q = await profilesRef.where('email', '==', email.toLowerCase().trim()).get();
        if (!q.empty) {
            const data = q.docs[0].data();
            return data.fullName || data.full_name || 'A Teacher';
        }
    } catch (err) {
        console.error('Error fetching teacher name:', err);
    }
    return 'A Teacher';
}

// Get subject emoji
function getSubjectEmoji(subject) {
    const map = {
        'Science': '🧬',
        'Mathematics': '🔢',
        'English': '🔤',
        'Sinhala': '📝',
        'ICT': '💻',
        'History': '🏛️',
        'Geography': '🌍',
        'Agri': '🌱',
        'Buddhism': '☸️',
        'Music': '🎶',
        'Drama': '🎭'
    };
    return map[subject] || '📚';
}

// --- MESSAGE FORMATTERS ---

// 1. Announcements
function sendAnnouncementToWhatsApp(data) {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    const emojiMap = { 'announcement': '📢', 'event': '🎉', 'urgent': '🚨' };
    const emoji = emojiMap[data.category] || '📌';
    
    const message = `
*${emoji} NEW ANNOUNCEMENT*
--------------------------------
*${data.title.toUpperCase()}*

${data.summary || data.content || ''}

🔗 *Read more:* https://dampellamv.vercel.app/news
--------------------------------
    `.trim();

    client.sendMessage(groupId, message, { linkPreview: false }).catch(err => console.error('Failed to send WhatsApp:', err));
}

// 2. Assignments
async function sendAssignmentToWhatsApp(data) {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    const teacherName = await getTeacherName(data.teacher_email);
    const subjectEmoji = getSubjectEmoji(data.subject);

    const message = `
*📝 NEW ASSIGNMENT POSTED*
--------------------------------
*SUBJECT:* ${subjectEmoji} ${data.subject}
*FOR:* 🎓 ${data.grade}
*BY:* 🧑‍🏫 ${teacherName}

📌 *TITLE:* ${data.title}
⏰ *DUE DATE:* ${data.due_date ? new Date(data.due_date).toLocaleDateString() : 'TBA'}

*INSTRUCTIONS:*
${data.description ? data.description.substring(0, 200) + (data.description.length > 200 ? '...' : '') : 'See portal for details.'}

🔗 *Access Portal:* https://dampellamv.vercel.app/portal
--------------------------------
    `.trim();

    client.sendMessage(groupId, message, { linkPreview: false }).catch(err => console.error('Failed to send WhatsApp:', err));
}

// 3. Quizzes
async function sendQuizToWhatsApp(data) {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    const teacherName = await getTeacherName(data.teacher_email);
    const subjectEmoji = getSubjectEmoji(data.subject);

    const message = `
*🧠 NEW INTERACTIVE QUIZ*
--------------------------------
*SUBJECT:* ${subjectEmoji} ${data.subject}
*FOR:* 🎓 ${data.grade}
*BY:* 🧑‍🏫 ${teacherName}

⭐ *QUIZ:* ${data.title}
🚀 *Level Up your knowledge!*

*SUMMARY:*
${data.description || 'Test your skills with this new assessment!'}

🔗 *Start Quiz Now:* https://dampellamv.vercel.app/portal
--------------------------------
    `.trim();

    client.sendMessage(groupId, message, { linkPreview: false }).catch(err => console.error('Failed to send WhatsApp:', err));
}

console.log('Starting WhatsApp Client...');
client.initialize().catch(err => {
    console.error('Initialization error:', err);
});
