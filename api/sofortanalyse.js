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
    var resendCheck = process.env.RESEND_API_KEY ? 'gesetzt (' + process.env.RESEND_API_KEY.length + ' Zeichen)' : 'FEHLT!';
    return res.status(200).json({ status: 'Funktion läuft', version: '18.0-fullpage', groq_key: keyCheck, resend_key: resendCheck });
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

  // Schritt 1: Website abrufen – komplette Startseite
  var seiteninhalt = '';
  try {
    var html = await httpsGet(fetchUrl);
    // Unwichtiges entfernen
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // Wichtige Elemente mit Kontext extrahieren
    var wichtig = '';
    var tags = ['h1','h2','h3','h4','p','li','a','button','span','div','section','header','footer','nav'];
    tags.forEach(function(tag) {
      var regex = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
      var match;
      while ((match = regex.exec(html)) !== null) {
        var text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 5) wichtig += text + '\n';
      }
    });

    // Duplikate entfernen und bereinigen
    var zeilen = wichtig.split('\n').filter(function(z, i, arr) {
      return z.length > 3 && arr.indexOf(z) === i;
    });
    seiteninhalt = zeilen.join('\n').substring(0, 12000);
  } catch (e) {
    console.log('Website-Abruf fehlgeschlagen:', e.message);
  }

  var systemMsg = 'Du bist Verkaufspsychologe nach der Farkas-Methode. Analysiere den Seiteninhalt und finde Optimierungspotentiale.\n\nWICHTIG:\n- Erfinde NICHTS. Erwähne nur Dinge die Du im Text tatsächlich siehst oder die EINDEUTIG fehlen\n- Wenn etwas vorhanden ist (z.B. Telefonnummer, E-Mail, Testimonials), nenne es NICHT als fehlend\n- Jeder Punkt: maximal 8 Wörter, prägnant, direkt\n- Fokus auf: schwaches Wertversprechen, fehlender Social Proof, unklare CTAs, fehlende Dringlichkeit, schwache Headlines, fehlende Garantien, unklare Zielgruppenansprache\n- Antworte NUR mit nummerierter Liste, kein anderer Text';

  var userMsg = seiteninhalt.length > 100
    ? 'Seiteninhalt von ' + url + ':\n\n' + seiteninhalt + '\n\nNenne 7 konkrete Optimierungspotentiale. Nur was Du im Text siehst oder eindeutig vermisst. Max. 8 Wörter pro Punkt.'
    : 'Analysiere ' + url + '. Nenne 7 Optimierungspotentiale, max. 8 Wörter pro Punkt.';

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

    // Nummerierte Liste parsen: "1. Text" → ["Text", ...]
    var results = content.split('\n')
      .map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•*]\s*/, '').trim(); })
      .filter(function(l) { return l.length > 8; });

    if (results.length === 0) results = [content.trim()];

    // E-Mail-Benachrichtigung via Resend
    var resendKey = process.env.RESEND_API_KEY;
    var emailStatus = 'nicht versucht';
    if (resendKey) {
      try {
        var emailHtml = '<h2>Neuer Lead – Sofortanalyse</h2>' +
          '<p><strong>Name:</strong> ' + (body.name || '–') + '</p>' +
          '<p><strong>E-Mail:</strong> ' + (body.email || '–') + '</p>' +
          '<p><strong>Website:</strong> ' + url + '</p>' +
          '<h3>Analyseergebnisse:</h3><ul>' +
          results.map(function(r) { return '<li>' + r + '</li>'; }).join('') +
          '</ul>';

        var mailResult = await httpsPost(
          'api.resend.com',
          '/emails',
          {
            from: 'Sofortanalyse <onboarding@resend.dev>',
            to: ['verkaufsoptimierung@gmail.com'],
            subject: 'Neuer Lead: ' + (body.name || 'Unbekannt') + ' – ' + url,
            html: emailHtml
          },
          { 'Authorization': 'Bearer ' + resendKey }
        );
        emailStatus = 'HTTP ' + mailResult.status + ': ' + mailResult.text.substring(0, 150);
      } catch (mailErr) {
        emailStatus = 'Fehler: ' + mailErr.message;
      }
    }

    return res.status(200).json({ results: results, debug_fetched: seiteninhalt.length, email_status: emailStatus });

  } catch (err) {
    console.error('Fehler:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
