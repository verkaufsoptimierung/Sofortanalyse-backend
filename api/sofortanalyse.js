// Vercel Serverless Function – Sofortanalyse mit Groq (Llama 3.1)

const https = require('https');

function httpsPost(hostname, path, data, headers) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var options = {
      hostname: hostname,
      path: path,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }, headers || {})
    };
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var loc = res.headers.location;
        if (!loc.startsWith('http')) loc = 'https://' + url.split('/')[2] + loc;
        return httpsGet(loc).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
    });
    req.on('error', reject);
    req.setTimeout(8000, function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    var keyCheck = process.env.GROQ_API_KEY ? 'gesetzt (' + process.env.GROQ_API_KEY.length + ' Zeichen)' : 'FEHLT!';
    return res.status(200).json({ status: 'Funktion läuft', version: '12.0-llama-3.3', groq_key: keyCheck });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  var body = req.body || {};
  var url = body.url;
  if (!url) return res.status(400).json({ error: 'URL fehlt' });

  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY nicht konfiguriert!' });

  // URL normalisieren
  var fetchUrl = url;
  if (!fetchUrl.startsWith('http')) fetchUrl = 'https://' + fetchUrl;

  // Schritt 1: Website abrufen
  var seiteninhalt = '';
  try {
    var html = await httpsGet(fetchUrl);
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<[^>]+>/g, ' ');
    html = html.replace(/\s+/g, ' ').trim();
    seiteninhalt = html.substring(0, 3000);
  } catch (e) {
    console.log('Website-Abruf fehlgeschlagen:', e.message);
  }

  var systemMsg = 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode. Du analysierst Websites und findest konkrete verkaufspsychologische Optimierungspotentiale. Antworte IMMER nur mit einem JSON-Array von 7 Strings auf Deutsch. Kein anderer Text, nur das JSON-Array.';

  var userMsg = seiteninhalt.length > 100
    ? 'Analysiere diesen Seiteninhalt von ' + url + ' und liefere 7 konkrete, kurze Optimierungspunkte (max. 15 Wörter pro Punkt).\n\nSeiteninhalt:\n' + seiteninhalt + '\n\nFormat: ["Punkt 1","Punkt 2","Punkt 3","Punkt 4","Punkt 5","Punkt 6","Punkt 7"]'
    : 'Analysiere die Website ' + url + ' und liefere 7 kurze Optimierungspunkte (max. 15 Wörter pro Punkt).\n\nFormat: ["Punkt 1","Punkt 2","Punkt 3","Punkt 4","Punkt 5","Punkt 6","Punkt 7"]';

  // Schritt 2: Groq aufrufen
  try {
    var result = await httpsPost(
      'api.groq.com',
      '/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.7,
        max_tokens: 1024
      },
      { 'Authorization': 'Bearer ' + apiKey }
    );

    if (result.status !== 200) {
      console.error('Groq Fehler:', result.status, result.text);
      return res.status(500).json({ error: 'Groq Fehler ' + result.status, detail: result.text.substring(0, 300) });
    }

    var data = JSON.parse(result.text);
    var content = data.choices[0].message.content.trim();

    var results;
    try {
      var cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      var jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      results = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    } catch (e) {
      results = content.split('\n')
        .map(function(l) { return l.replace(/^[\s\-•*"\d.]+/, '').replace(/[",]+$/, '').trim(); })
        .filter(function(l) { return l.length > 10; });
    }

    if (!Array.isArray(results)) results = [String(results)];
    results = results.filter(function(r) { return r && String(r).trim().length > 5; });

    return res.status(200).json({ results: results, debug_fetched: seiteninhalt.length });

  } catch (err) {
    console.error('Fehler:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
