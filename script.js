'use strict';

/* ============================ */
/* Konfiguration & Globale Variablen */
/* ============================ */

// WebRTC-Konfiguration mit STUN-Server
const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let localConnection = new RTCPeerConnection(configuration);
let dataChannel; // Wird für alle Daten (Dateien, Chat, Standort, Snapshot) genutzt

// UI-Elemente
const createOfferBtn   = document.getElementById('createOffer');
const connectBtn       = document.getElementById('connect');
const offerTextArea    = document.getElementById('offer');
const answerTextArea   = document.getElementById('answer');
const connectionStatus = document.getElementById('connectionStatus');

const fileInput    = document.getElementById('fileInput');
const sendFileBtn  = document.getElementById('sendFile');
const fileStatus   = document.getElementById('fileStatus');
const fileProgress = document.getElementById('fileProgress');

const chatLog    = document.getElementById('chatLog');
const chatInput  = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChat');

const videoPreview     = document.getElementById('videoPreview');
const captureSnapshot  = document.getElementById('captureSnapshot');
const snapshotPreview  = document.getElementById('snapshotPreview');

const shareLocationBtn = document.getElementById('shareLocation');
const locationStatus   = document.getElementById('locationStatus');

const compassCanvas = document.getElementById('compassCanvas');
const ctx           = compassCanvas.getContext('2d');

// Für Geolokalisierung
let localLocation  = null;  // { lat: ..., lon: ... }
let remoteLocation = null;  // { lat: ..., lon: ... }
let deviceOrientation = 0;  // Falls verfügbar

/* ============================ */
/* Hilfsfunktionen: Base64-Konvertierung, Verschlüsselung & Entschlüsselung */
/* ============================ */

// Konvertiert ArrayBuffer in Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let b of bytes) {
    binary += String.fromCharCode(b);
  }
  return window.btoa(binary);
}

// Konvertiert Base64 in ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Statischer Passphrasenschlüssel (nur für Demonstrationszwecke!)
const passphrase = 'passwort123';

// Verschlüsselt gegebene Daten (ArrayBuffer) mittels AES-GCM und gibt ein ArrayBuffer zurück (IV vorangestellt)
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
  // Kombinieren: IV + verschlüsselte Daten
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return combined.buffer;
}

// Entschlüsselt Daten (ArrayBuffer, IV vorne angehängt) mittels AES-GCM
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
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
}

/* ============================ */
/* WebRTC & DataChannel Einrichtung */
/* ============================ */

// Funktion zur Einrichtung des DataChannels
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
    // Falls die Nachricht als String übermittelt wird, interpretieren wir sie als JSON
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error('Fehler beim Parsen der JSON-Nachricht:', err);
      }
    } else {
      // Sollte hier Binärdaten ankommen – im vorliegenden Protokoll senden wir alle komplexen Inhalte als JSON (Base64‑codiert)
      console.warn("Unerwarteter Binärdatentyp empfangen.");
    }
  };
}

// Falls der Peer den DataChannel initiiert
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
        console.error('Fehler beim Parsen der Nachricht:', err);
      }
    }
  };
};

// ICE-Kandidaten austauschen (hier manuell über die Textfelder)
localConnection.onicecandidate = (event) => {
  if (event.candidate === null) {
    console.log("ICE-Gathering abgeschlossen.");
    // Sobald ICE abgeschlossen ist, wird das Angebot im Textfeld angezeigt
    offerTextArea.value = JSON.stringify(localConnection.localDescription);
  }
};

/* ============================ */
/* Message-Handler für den DataChannel */
/* ============================ */

async function handleMessage(msg) {
  switch (msg.type) {

    case "chat":
      appendChatMessage("Peer", msg.message, msg.timestamp);
      break;

    case "file":
      // Empfangen einer Datei: Wir entschlüsseln und bieten zum Download an
      fileStatus.textContent = `Datei "${msg.filename}" empfangen (${msg.size} Bytes). Entschlüsselung läuft...`;
      try {
        const encryptedBuffer = base64ToArrayBuffer(msg.data);
        const decryptedBuffer = await decryptData(encryptedBuffer);
        const blob = new Blob([decryptedBuffer]);
        const url = URL.createObjectURL(blob);
        fileStatus.innerHTML = `Datei "${msg.filename}" empfangen. <a href="${url}" download="${msg.filename}">Herunterladen</a>`;
      } catch (err) {
        console.error("Fehler bei der Entschlüsselung der Datei:", err);
        fileStatus.textContent = "Fehler bei der Entschlüsselung der Datei.";
      }
      break;

    case "snapshot":
      // Empfangen eines Snapshots (als Base64-String)
      const img = document.createElement('img');
      img.src = msg.data;
      snapshotPreview.innerHTML = "";
      snapshotPreview.appendChild(img);
      break;

    case "location":
      // Empfangen von Standortdaten des Peers
      remoteLocation = { lat: msg.lat, lon: msg.lon };
      locationStatus.textContent = `Peer Standort empfangen: Lat ${msg.lat.toFixed(4)}, Lon ${msg.lon.toFixed(4)}`;
      updateCompass();
      break;

    default:
      console.warn("Unbekannter Nachrichtentyp:", msg.type);
  }
}

/* ============================ */
/* UI-Interaktionen & Event-Listener */
/* ============================ */

// Erzeugen eines Angebots (Offer)
createOfferBtn.addEventListener('click', async () => {
  setupDataChannel();
  try {
    const offer = await localConnection.createOffer();
    await localConnection.setLocalDescription(offer);
    // Sobald ICE-Gathering abgeschlossen ist, erscheint das Angebot im Textfeld
  } catch (err) {
    console.error("Fehler beim Erstellen des Angebots:", err);
  }
});

// Setzen der Remote Description anhand der Antwort
connectBtn.addEventListener('click', async () => {
  try {
    const answer = JSON.parse(answerTextArea.value);
    await localConnection.setRemoteDescription(answer);
    console.log("Remote Description gesetzt.");
  } catch (err) {
    console.error("Fehler beim Setzen der Remote Description:", err);
  }
});

// Dateiübertragung (inkl. Verschlüsselung und Base64-Codierung)
sendFileBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert("Bitte wählen Sie eine Datei aus!");
    return;
  }
  fileStatus.textContent = `Datei "${file.name}" wird gelesen...`;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const arrayBuffer = reader.result;
      const encryptedBuffer = await encryptData(arrayBuffer);
      const base64Data = arrayBufferToBase64(encryptedBuffer);
      // Senden als JSON-Nachricht
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
      console.error("Fehler bei der Datei-Verschlüsselung:", err);
      fileStatus.textContent = "Fehler beim Verschlüsseln der Datei.";
    }
  };
  reader.readAsArrayBuffer(file);
});

// Chat-Funktionalität
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

// Webcam-Snapshot: Video-Stream starten und Snapshot aufnehmen
async function startVideoStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoPreview.srcObject = stream;
  } catch (err) {
    console.error("Fehler beim Zugriff auf die Webcam:", err);
  }
}
startVideoStream();

captureSnapshot.addEventListener('click', async () => {
  const snapshotCanvas = document.createElement('canvas');
  snapshotCanvas.width = videoPreview.videoWidth;
  snapshotCanvas.height = videoPreview.videoHeight;
  const snapCtx = snapshotCanvas.getContext('2d');
  snapCtx.drawImage(videoPreview, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  // Erzeugt einen DataURL (Base64)
  const dataURL = snapshotCanvas.toDataURL("image/png");
  // Senden als Snapshot-Nachricht
  const msg = { type: "snapshot", data: dataURL };
  dataChannel.send(JSON.stringify(msg));
  // Anzeige des lokalen Snapshots
  snapshotPreview.innerHTML = "";
  const img = document.createElement('img');
  img.src = dataURL;
  snapshotPreview.appendChild(img);
});

// Standort teilen: Geolocation API nutzen und Standortdaten versenden
shareLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Geolocation wird von Ihrem Browser nicht unterstützt.";
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    localLocation = {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    };
    locationStatus.textContent = `Ihr Standort: Lat ${localLocation.lat.toFixed(4)}, Lon ${localLocation.lon.toFixed(4)}`;
    // Senden der Standortdaten an den Peer
    const msg = { type: "location", lat: localLocation.lat, lon: localLocation.lon };
    dataChannel.send(JSON.stringify(msg));
    updateCompass();
  }, (err) => {
    console.error("Fehler beim Ermitteln des Standorts:", err);
    locationStatus.textContent = "Fehler beim Ermitteln des Standorts.";
  });
});

/* ============================ */
/* Kompass-Funktionalität inkl. Berechnung des Richtungsvektors */
/* ============================ */

// Berechnet den Kurs (in Grad) zwischen zwei geographischen Punkten
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

// Zeichnet den Kompass auf dem Canvas
function drawCompass(angle = 0) {
  const width = compassCanvas.width;
  const height = compassCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  ctx.clearRect(0, 0, width, height);

  // Äußerer Kreis
  ctx.beginPath();
  ctx.arc(centerX, centerY, 110, 0, 2 * Math.PI);
  ctx.strokeStyle = '#4a90e2';
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
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#333';
  ctx.fillText('N', centerX - 6, centerY - 90);
}

// Aktualisiert den Kompass: Falls beide Standorte vorliegen, wird der relative Kurs berechnet
function updateCompass() {
  let angle = 0;
  if (localLocation && remoteLocation) {
    const bearing = calculateBearing(localLocation.lat, localLocation.lon, remoteLocation.lat, remoteLocation.lon);
    // Falls DeviceOrientation vorliegt, kann der reale Kompasskurs ermittelt werden
    angle = (bearing - deviceOrientation) * Math.PI / 180;
  } else {
    // Andernfalls simulieren wir eine Rotation
    angle = Date.now() / 3000;
  }
  drawCompass(angle);
}

// Aktualisierung des Kompasses in regelmäßigen Abständen
setInterval(updateCompass, 100);

/* ============================ */
/* DeviceOrientationEvent: Aktualisierung des Gerätedrehwinkels */
/* ============================ */
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (event) => {
    if (event.alpha !== null) {
      deviceOrientation = event.alpha; // alpha in Grad
      updateCompass();
    }
  }, true);
}
