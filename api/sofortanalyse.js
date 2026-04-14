// Vercel Serverless Function – Sofortanalyse mit Google Gemini
// Verwendet https-Modul statt fetch (funktioniert in allen Node-Versionen)

const https = require('https');

function httpsPost(hostname, path, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var options = {
      hostname: hostname,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, text: text });
      });
    });
    req.on('error', function(err) { reject(err); });
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      // Redirects folgen
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
    var apiKey2 = process.env.GEMINI_API_KEY;
    var keyCheck = apiKey2 ? 'gesetzt (' + apiKey2.length + ' Zeichen)' : 'FEHLT!';
    // Verfügbare Modelle abrufen
    try {
      var modelsResult = await new Promise(function(resolve, reject) {
        var req2 = https.get('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey2, function(r) {
          var chunks = [];
          r.on('data', function(c) { chunks.push(c); });
          r.on('end', function() { resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString() }); });
        });
        req2.on('error', reject);
        req2.setTimeout(5000, function() { req2.destroy(); reject(new Error('Timeout')); });
      });
      var modelsData = JSON.parse(modelsResult.text);
      var modelNames = (modelsData.models || []).map(function(m) { return m.name; });
      return res.status(200).json({ status: 'Funktion läuft', version: '8.0-fix-parsing', gemini_key: keyCheck, verfuegbare_modelle: modelNames });
    } catch(e) {
      return res.status(200).json({ status: 'Funktion läuft', version: '8.0-fix-parsing', gemini_key: keyCheck, modell_fehler: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  var body = req.body || {};
  var url = body.url;
  if (!url) return res.status(400).json({ error: 'URL fehlt' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY nicht konfiguriert!' });

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
    seiteninhalt = html.substring(0, 4000);
  } catch (e) {
    console.log('Website-Abruf fehlgeschlagen:', e.message);
  }

  var prompt = seiteninhalt.length > 100
    ? 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode.\n\nAnalysiere den folgenden Seiteninhalt der Website ' + url + ' und finde konkrete verkaufspsychologische Optimierungspotentiale.\n\nSeiteninhalt:\n' + seiteninhalt + '\n\nRegeln:\n- Liefere genau 6-8 kurze, prägnante Stichpunkte\n- Beziehe Dich konkret auf den Inhalt der Seite\n- Fokus auf: Wertversprechen, Social Proof, Dringlichkeit, CTA, Einwandbehandlung, Vertrauen, Storytelling\n- Antworte NUR mit einem JSON-Array von Strings\n- Sprache: Deutsch\n\nFormat: ["Stichpunkt 1","Stichpunkt 2",...]'
    : 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode.\n\nAnalysiere die Website ' + url + ' und nenne typische Optimierungspotentiale für diese Art von Website.\n\nRegeln:\n- Liefere genau 6-8 kurze, prägnante Stichpunkte\n- Fokus auf: Wertversprechen, Social Proof, Dringlichkeit, CTA, Einwandbehandlung, Vertrauen, Storytelling\n- Antworte NUR mit einem JSON-Array von Strings\n- Sprache: Deutsch\n\nFormat: ["Stichpunkt 1","Stichpunkt 2",...]';

  // Schritt 2: Gemini aufrufen
  try {
    var result = await httpsPost(
      'generativelanguage.googleapis.com',
      '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      }
    );

    if (result.status !== 200) {
      console.error('Gemini Fehler:', result.status, result.text);
      return res.status(500).json({ error: 'Gemini Fehler ' + result.status, detail: result.text.substring(0, 300) });
    }

    var data = JSON.parse(result.text);
    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({ error: 'Keine Kandidaten', raw: result.text.substring(0, 300) });
    }

    var content = data.candidates[0].content.parts[0].text.trim();
    var results;
    try {
      // Markdown-Code-Block entfernen falls vorhanden
      var cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      var jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        results = JSON.parse(cleaned);
      }
    } catch (e) {
      // Zeilenweises Fallback-Parsing
      results = content.split('\n')
        .map(function(l) { return l.replace(/^[\s\-•*"\d.]+/, '').replace(/[",]+$/, '').trim(); })
        .filter(function(l) { return l.length > 15; });
    }
    // Sicherstellen dass es ein Array ist
    if (!Array.isArray(results)) results = [String(results)];
    // Leere Einträge entfernen
    results = results.filter(function(r) { return r && String(r).trim().length > 5; });

    return res.status(200).json({ results: results, debug_fetched: seiteninhalt.length, debug_raw: content.substring(0, 300) });

  } catch (err) {
    console.error('Fehler:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
