'use strict';

/* ============================
   Konfiguration & Globale Variablen
   ============================ */
const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let localConnection = new RTCPeerConnection(configuration);
let dataChannel; // Gemeinsamer Kanal für alle Nachrichten

// UI-Elemente
const createOfferBtn   = document.getElementById('createOffer');
const copyOfferBtn     = document.getElementById('copyOffer');
const connectBtn       = document.getElementById('connect');
const offerTextArea    = document.getElementById('offer');
const answerTextArea   = document.getElementById('answer');
const connectionStatus = document.getElementById('connectionStatus');
const qrCodeContainer  = document.getElementById('qrCode');

const fileInput    = document.getElementById('fileInput');
const sendFileBtn  = document.getElementById('sendFile');
const fileStatus   = document.getElementById('fileStatus');
const fileProgress = document.getElementById('fileProgress');

const chatLog      = document.getElementById('chatLog');
const chatInput    = document.getElementById('chatInput');
const sendChatBtn  = document.getElementById('sendChat');

const videoPreview    = document.getElementById('videoPreview');
const captureSnapshot = document.getElementById('captureSnapshot');
const snapshotPreview = document.getElementById('snapshotPreview');

const shareLocationBtn = document.getElementById('shareLocation');
const locationStatus   = document.getElementById('locationStatus');

const compassCanvas = document.getElementById('compassCanvas');
const ctx           = compassCanvas.getContext('2d');

let localLocation  = null;  // { lat: ..., lon: ... }
let remoteLocation = null;  // { lat: ..., lon: ... }
let deviceOrientation = 0;  // falls verfügbar

/* ============================
   Hilfsfunktionen: Base64, Verschlüsselung & Entschlüsselung
   ============================
   (Die folgenden Funktionen ermöglichen es, Daten zu verschlüsseln und zu konvertieren.)
*/
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

const passphrase = 'passwort123'; // Nur zu Demonstrationszwecken!

async function encryptData(data) {
  const keyMaterial = new TextEncoder().encode(passphrase);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    data
  );
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return combined.buffer;
}

async function decryptData(encryptedData) {
  const keyMaterial = new TextEncoder().encode(passphrase);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const data = new Uint8Array(encryptedData);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
}

/* ============================
   WebRTC & DataChannel Einrichtung
   ============================
   Hier wird der DataChannel erstellt und konfiguriert – dies erfolgt entweder lokal oder remote.
*/
function setupDataChannel() {
  dataChannel = localConnection.createDataChannel("querkChannel");
  dataChannel.onopen = () => {
    console.log('DataChannel geöffnet');
    connectionStatus.textContent = "Verbindung hergestellt.";
  };
  dataChannel.onclose = () => {
    console.log('DataChannel geschlossen');
    connectionStatus.textContent = "Verbindung getrennt.";
  };
  dataChannel.onerror = (err) => {
    console.error('DataChannel Fehler:', err);
  };
  dataChannel.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error('JSON-Fehler:', err);
      }
    } else {
      console.warn("Unbekannter Datentyp empfangen.");
    }
  };
}

localConnection.ondatachannel = (event) => {
  dataChannel = event.channel;
  dataChannel.onopen = () => {
    console.log('Remote DataChannel geöffnet');
    connectionStatus.textContent = "Remote Verbindung hergestellt.";
  };
  dataChannel.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error('JSON-Fehler:', err);
      }
    }
  };
};

localConnection.onicecandidate = (event) => {
  if (event.candidate === null) {
    console.log("ICE-Gathering abgeschlossen.");
    offerTextArea.value = JSON.stringify(localConnection.localDescription);
    generateQRCode(offerTextArea.value);
  }
};

/* ============================
   QR-Code Generierung
   ============================
   Mit Hilfe der eingebundenen QRCode.js wird aus dem Angebot ein QR-Code erstellt.
*/
function generateQRCode(text) {
  // Leeren des Containers
  qrCodeContainer.innerHTML = "";
  // Erzeugen des QR-Codes
  new QRCode(qrCodeContainer, {
    text: text,
    width: 180,
    height: 180,
    colorDark : "#1d2671",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
}

/* ============================
   Message-Handler
   ============================
   Die Funktion verarbeitet alle Nachrichten (Chat, Datei, Snapshot, Standort) vom Peer.
*/
async function handleMessage(msg) {
  switch (msg.type) {
    case "chat":
      appendChatMessage("Peer", msg.message, msg.timestamp);
      break;
    case "file":
      fileStatus.textContent = `Datei "${msg.filename}" empfangen (${msg.size} Bytes). Entschlüsselung läuft...`;
      try {
        const encryptedBuffer = base64ToArrayBuffer(msg.data);
        const decryptedBuffer = await decryptData(encryptedBuffer);
        const blob = new Blob([decryptedBuffer]);
        const url = URL.createObjectURL(blob);
        fileStatus.innerHTML = `Datei "${msg.filename}" empfangen. <a href="${url}" download="${msg.filename}">Herunterladen</a>`;
      } catch (err) {
        console.error("Entschlüsselungsfehler:", err);
        fileStatus.textContent = "Fehler bei der Entschlüsselung der Datei.";
      }
      break;
    case "snapshot":
      const img = document.createElement('img');
      img.src = msg.data;
      snapshotPreview.innerHTML = "";
      snapshotPreview.appendChild(img);
      break;
    case "location":
      remoteLocation = { lat: msg.lat, lon: msg.lon };
      locationStatus.textContent = `Peer Standort: Lat ${msg.lat.toFixed(4)}, Lon ${msg.lon.toFixed(4)}`;
      updateCompass();
      break;
    default:
      console.warn("Unbekannter Nachrichtentyp:", msg.type);
  }
}

/* ============================
   UI-Interaktionen & Event-Listener
   ============================
   Hier erfolgt die Interaktion mit der Benutzeroberfläche.
*/
// Angebot erstellen
createOfferBtn.addEventListener('click', async () => {
  setupDataChannel();
  try {
    const offer = await localConnection.createOffer();
    await localConnection.setLocalDescription(offer);
    // Das Angebot wird über ICE automatisch in das Textfeld geschrieben.
  } catch (err) {
    console.error("Fehler beim Erstellen des Angebots:", err);
  }
});

// Angebot kopieren (zum einfachen Austausch)
copyOfferBtn.addEventListener('click', () => {
  offerTextArea.select();
  document.execCommand('copy');
  alert('Angebot wurde in die Zwischenablage kopiert.');
});

// Verbindung herstellen
connectBtn.addEventListener('click', async () => {
  try {
    const answer = JSON.parse(answerTextArea.value);
    await localConnection.setRemoteDescription(answer);
    console.log("Remote Description gesetzt.");
  } catch (err) {
    console.error("Fehler beim Setzen der Remote Description:", err);
  }
});

// Datei senden
sendFileBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert("Bitte wählen Sie eine Datei aus!");
    return;
  }
  fileStatus.textContent = `Lese Datei "${file.name}"...`;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const arrayBuffer = reader.result;
      const encryptedBuffer = await encryptData(arrayBuffer);
      const base64Data = arrayBufferToBase64(encryptedBuffer);
      const msg = {
        type: "file",
        filename: file.name,
        size: file.size,
        data: base64Data
      };
      dataChannel.send(JSON.stringify(msg));
      fileStatus.textContent = `Datei "${file.name}" gesendet.`;
      fileProgress.value = 100;
    } catch (err) {
      console.error("Fehler bei der Verschlüsselung:", err);
      fileStatus.textContent = "Fehler beim Verschlüsseln der Datei.";
    }
  };
  reader.readAsArrayBuffer(file);
});

// Chat senden
sendChatBtn.addEventListener('click', () => {
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
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Webcam starten und Snapshot aufnehmen
async function startVideoStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoPreview.srcObject = stream;
  } catch (err) {
    console.error("Webcam-Fehler:", err);
  }
}
startVideoStream();

captureSnapshot.addEventListener('click', async () => {
  const snapshotCanvas = document.createElement('canvas');
  snapshotCanvas.width = videoPreview.videoWidth;
  snapshotCanvas.height = videoPreview.videoHeight;
  const snapCtx = snapshotCanvas.getContext('2d');
  snapCtx.drawImage(videoPreview, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  const dataURL = snapshotCanvas.toDataURL("image/png");
  const msg = { type: "snapshot", data: dataURL };
  dataChannel.send(JSON.stringify(msg));
  snapshotPreview.innerHTML = "";
  const img = document.createElement('img');
  img.src = dataURL;
  snapshotPreview.appendChild(img);
});

// Standort teilen
shareLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Geolocation wird nicht unterstützt.";
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    localLocation = {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    };
    locationStatus.textContent = `Ihr Standort: Lat ${localLocation.lat.toFixed(4)}, Lon ${localLocation.lon.toFixed(4)}`;
    const msg = { type: "location", lat: localLocation.lat, lon: localLocation.lon };
    dataChannel.send(JSON.stringify(msg));
    updateCompass();
  }, (err) => {
    console.error("Standortfehler:", err);
    locationStatus.textContent = "Fehler beim Ermitteln des Standorts.";
  });
});

/* ============================
   Kompass-Funktionalität
   ============================
   Die folgenden Funktionen berechnen anhand der Standortdaten den relativen Kurs und zeichnen einen dynamischen Kompass.
*/
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
  const width = compassCanvas.width;
  const height = compassCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  ctx.clearRect(0, 0, width, height);

  // Äußerer Kreis
  ctx.beginPath();
  ctx.arc(centerX, centerY, 110, 0, 2 * Math.PI);
  ctx.strokeStyle = '#1d2671';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Kompasszeiger (Dreieck)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -80);
  ctx.lineTo(12, 10);
  ctx.lineTo(-12, 10);
  ctx.closePath();
  ctx.fillStyle = 'red';
  ctx.fill();
  ctx.restore();

  // Norden-Kennzeichnung
  ctx.font = '16px Roboto, sans-serif';
  ctx.fillStyle = '#333';
  ctx.fillText('N', centerX - 6, centerY - 90);
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
