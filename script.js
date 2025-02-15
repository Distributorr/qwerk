'use strict';

/* ============================
   Grundkonfiguration & Globale Variablen
============================ */
const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let localConnection = new RTCPeerConnection(configuration);
let dataChannel; // Gemeinsamer Kanal für Nachrichten
let localLocation = null;   // { lat, lon }
let remoteLocation = null;  // { lat, lon }
let deviceOrientation = 0;  // falls verfügbar

/* ============================
   Tab-Steuerung
============================ */
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(btn => {
  btn.addEventListener('click', () => {
    // Alle Tabs deaktivieren
    tabLinks.forEach(b => b.classList.remove('active'));
    tabContents.forEach(sec => sec.classList.remove('active'));
    // Aktivieren des ausgewählten Tabs
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

/* ============================
   Hilfsfunktionen: Base64, Verschlüsselung
============================ */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let b of bytes) {
    binary += String.fromCharCode(b);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

const passphrase = 'passwort123'; // Demo-Zwecke

async function encryptData(data) {
  const keyMaterial = new TextEncoder().encode(passphrase);
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return combined.buffer;
}

async function decryptData(encryptedData) {
  const keyMaterial = new TextEncoder().encode(passphrase);
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
  const data = new Uint8Array(encryptedData);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}

/* ============================
   WebRTC & DataChannel Einrichtung
============================ */
const offerTextArea    = document.getElementById('offer');
const answerTextArea   = document.getElementById('answer');
const connectionStatus = document.getElementById('connectionStatus');
const qrCodeContainer  = document.getElementById('qrCode');

function setupDataChannel() {
  dataChannel = localConnection.createDataChannel("querkChannel");
  dataChannel.onopen = () => {
    connectionStatus.textContent = "Verbindung hergestellt.";
  };
  dataChannel.onclose = () => {
    connectionStatus.textContent = "Verbindung getrennt.";
  };
  dataChannel.onerror = (err) => console.error("DataChannel Fehler:", err);
  dataChannel.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error("JSON-Fehler:", err);
      }
    }
  };
}

localConnection.ondatachannel = (event) => {
  dataChannel = event.channel;
  dataChannel.onopen = () => {
    connectionStatus.textContent = "Remote Verbindung hergestellt.";
  };
  dataChannel.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error("JSON-Fehler:", err);
      }
    }
  };
};

localConnection.onicecandidate = (event) => {
  if (!event.candidate) {
    // ICE-Gathering abgeschlossen
    offerTextArea.value = JSON.stringify(localConnection.localDescription);
    generateQRCode(offerTextArea.value);
  }
};

/* ============================
   QR-Code Generierung (Einfach gehalten)
============================ */
function generateQRCode(text) {
  qrCodeContainer.innerHTML = "";
  new QRCode(qrCodeContainer, {
    text: text,
    width: 120,
    height: 120,
    colorDark: "#283e51",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

/* ============================
   Message-Handler
============================ */
async function handleMessage(msg) {
  switch (msg.type) {
    case "chat":
      appendChatMessage("Peer", msg.message, msg.timestamp);
      break;
    case "file":
      document.getElementById('fileStatus').textContent =
        `Datei "${msg.filename}" empfangen (${msg.size} Bytes). Entschlüsselung läuft...`;
      try {
        const encryptedBuffer = base64ToArrayBuffer(msg.data);
        const decryptedBuffer = await decryptData(encryptedBuffer);
        const blob = new Blob([decryptedBuffer]);
        const url = URL.createObjectURL(blob);
        document.getElementById('fileStatus').innerHTML =
          `Datei "${msg.filename}" empfangen. <a href="${url}" download="${msg.filename}">Herunterladen</a>`;
      } catch (err) {
        console.error("Entschlüsselungsfehler:", err);
      }
      break;
    case "snapshot":
      const img = document.createElement('img');
      img.src = msg.data;
      document.getElementById('snapshotPreview').innerHTML = "";
      document.getElementById('snapshotPreview').appendChild(img);
      break;
    case "location":
      remoteLocation = { lat: msg.lat, lon: msg.lon };
      document.getElementById('locationStatus').textContent =
        `Peer Standort: Lat ${msg.lat.toFixed(4)}, Lon ${msg.lon.toFixed(4)}`;
      updateCompass();
      break;
    default:
      console.warn("Unbekannter Nachrichtentyp:", msg.type);
  }
}

/* ============================
   UI-Interaktionen & Event-Listener
============================ */
document.getElementById('createOffer').addEventListener('click', async () => {
  setupDataChannel();
  try {
    const offer = await localConnection.createOffer();
    await localConnection.setLocalDescription(offer);
  } catch (err) {
    console.error("Fehler beim Erstellen des Angebots:", err);
  }
});

document.getElementById('copyOffer').addEventListener('click', () => {
  offerTextArea.select();
  document.execCommand('copy');
  alert('Angebot in Zwischenablage kopiert.');
});

document.getElementById('connect').addEventListener('click', async () => {
  try {
    const answer = JSON.parse(answerTextArea.value);
    await localConnection.setRemoteDescription(answer);
  } catch (err) {
    console.error("Fehler beim Setzen der Remote Description:", err);
  }
});

// Dateiübertragung
document.getElementById('sendFile').addEventListener('click', async () => {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return alert("Bitte wählen Sie eine Datei aus!");
  document.getElementById('fileStatus').textContent = `Lese Datei "${file.name}"...`;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const encryptedBuffer = await encryptData(reader.result);
      const base64Data = arrayBufferToBase64(encryptedBuffer);
      const msg = { type: "file", filename: file.name, size: file.size, data: base64Data };
      dataChannel.send(JSON.stringify(msg));
      document.getElementById('fileStatus').textContent = `Datei "${file.name}" gesendet.`;
    } catch (err) {
      console.error("Verschlüsselungsfehler:", err);
    }
  };
  reader.readAsArrayBuffer(file);
});

// Chat
document.getElementById('sendChat').addEventListener('click', () => {
  const chatInput = document.getElementById('chatInput');
  const message = chatInput.value.trim();
  if (!message) return;
  const timestamp = new Date().toLocaleTimeString();
  const msg = { type: "chat", message, timestamp };
  dataChannel.send(JSON.stringify(msg));
  appendChatMessage("Ich", message, timestamp);
  chatInput.value = "";
});

function appendChatMessage(sender, message, timestamp) {
  const div = document.createElement('div');
  div.classList.add('chatMessage');
  div.innerHTML = `<strong>${sender}</strong> [${timestamp}]: ${message}`;
  document.getElementById('chatLog').appendChild(div);
  document.getElementById('chatLog').scrollTop = document.getElementById('chatLog').scrollHeight;
}

// Webcam & Snapshot
async function startVideoStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    document.getElementById('videoPreview').srcObject = stream;
  } catch (err) {
    console.error("Webcam Fehler:", err);
  }
}
startVideoStream();

document.getElementById('captureSnapshot').addEventListener('click', async () => {
  const video = document.getElementById('videoPreview');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataURL = canvas.toDataURL("image/png");
  const msg = { type: "snapshot", data: dataURL };
  dataChannel.send(JSON.stringify(msg));
  document.getElementById('snapshotPreview').innerHTML = "";
  const img = document.createElement('img');
  img.src = dataURL;
  document.getElementById('snapshotPreview').appendChild(img);
});

// Standort & Kompass
document.getElementById('shareLocation').addEventListener('click', () => {
  if (!navigator.geolocation) {
    document.getElementById('locationStatus').textContent = "Geolocation wird nicht unterstützt.";
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    localLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
    document.getElementById('locationStatus').textContent =
      `Ihr Standort: Lat ${localLocation.lat.toFixed(4)}, Lon ${localLocation.lon.toFixed(4)}`;
    const msg = { type: "location", lat: localLocation.lat, lon: localLocation.lon };
    dataChannel.send(JSON.stringify(msg));
    updateCompass();
  }, (err) => {
    console.error("Standortfehler:", err);
    document.getElementById('locationStatus').textContent = "Fehler beim Ermitteln des Standorts.";
  });
});

const compassCanvas = document.getElementById('compassCanvas');
const ctx = compassCanvas.getContext('2d');

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

function drawCompass(angle = 0) {
  const width = compassCanvas.width, height = compassCanvas.height;
  const centerX = width / 2, centerY = height / 2;
  ctx.clearRect(0, 0, width, height);
  // Äußerer Kreis
  ctx.beginPath();
  ctx.arc(centerX, centerY, 110, 0, 2 * Math.PI);
  ctx.strokeStyle = "#283e51";
  ctx.lineWidth = 3;
  ctx.stroke();
  // Zeiger (Dreieck)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -80);
  ctx.lineTo(12, 10);
  ctx.lineTo(-12, 10);
  ctx.closePath();
  ctx.fillStyle = "red";
  ctx.fill();
  ctx.restore();
  // Norden-Kennzeichnung
  ctx.font = "16px Roboto, sans-serif";
  ctx.fillStyle = "#333";
  ctx.fillText("N", centerX - 6, centerY - 90);
}

function updateCompass() {
  let angle = 0;
  if (localLocation && remoteLocation) {
    const bearing = calculateBearing(localLocation.lat, localLocation.lon, remoteLocation.lat, remoteLocation.lon);
    angle = (bearing - deviceOrientation) * Math.PI / 180;
  } else {
    angle = Date.now() / 3000;
  }
  drawCompass(angle);
}

setInterval(updateCompass, 100);

if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (event) => {
    if (event.alpha !== null) {
      deviceOrientation = event.alpha;
      updateCompass();
    }
  }, true);
}
