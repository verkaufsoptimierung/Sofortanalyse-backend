// Vercel Serverless Function – Sofortanalyse mit Google Gemini
// Website wird serverseitig abgerufen, dann von Gemini analysiert

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET-Test
  if (req.method === 'GET') {
    var keyCheck = process.env.GEMINI_API_KEY ? 'gesetzt (' + process.env.GEMINI_API_KEY.length + ' Zeichen)' : 'FEHLT!';
    return res.status(200).json({ status: 'Funktion läuft', gemini_key: keyCheck });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  var body = req.body || {};
  var url = body.url;

  if (!url) return res.status(400).json({ error: 'URL fehlt' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY nicht konfiguriert in Vercel!' });

  // Sicherstellen dass URL mit https:// beginnt
  var fetchUrl = url;
  if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
    fetchUrl = 'https://' + fetchUrl;
  }

  // Schritt 1: Website abrufen
  var seiteninhalt = '';
  try {
    var siteResponse = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ConversionAnalyser/1.0)',
        'Accept': 'text/html'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });

    if (siteResponse.ok) {
      var html = await siteResponse.text();

      // HTML bereinigen: Scripts, Styles, SVGs entfernen
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
      html = html.replace(/<svg[\s\S]*?<\/svg>/gi, '');
      html = html.replace(/<!--[\s\S]*?-->/g, '');

      // Tags entfernen, nur Text behalten
      var text = html.replace(/<[^>]+>/g, ' ');
      text = text.replace(/\s+/g, ' ').trim();

      // Auf 4000 Zeichen begrenzen (reicht für die Startseite)
      seiteninhalt = text.substring(0, 4000);
    }
  } catch (fetchErr) {
    console.log('Website konnte nicht abgerufen werden:', fetchErr.message);
    // Weiter mit URL-only-Analyse wenn Website nicht erreichbar
  }

  var prompt;
  if (seiteninhalt.length > 100) {
    prompt = 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode.\n\nAnalysiere den folgenden Seiteninhalt der Website ' + url + ' und finde konkrete verkaufspsychologische Optimierungspotentiale.\n\nSeiteninhalt:\n' + seiteninhalt + '\n\nRegeln:\n- Liefere genau 6-8 kurze, prägnante Stichpunkte\n- Beziehe Dich konkret auf den Inhalt der Seite\n- Fokus auf: Wertversprechen, Social Proof, Dringlichkeit, CTA, Einwandbehandlung, Vertrauen, Storytelling\n- Antworte NUR mit einem JSON-Array von Strings\n- Sprache: Deutsch\n\nFormat: ["Stichpunkt 1","Stichpunkt 2",...]';
  } else {
    prompt = 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode.\n\nAnalysiere die Website ' + url + ' und nenne typische Optimierungspotentiale für diese Art von Website.\n\nRegeln:\n- Liefere genau 6-8 kurze, prägnante Stichpunkte\n- Fokus auf: Wertversprechen, Social Proof, Dringlichkeit, CTA, Einwandbehandlung, Vertrauen, Storytelling\n- Antworte NUR mit einem JSON-Array von Strings\n- Sprache: Deutsch\n\nFormat: ["Stichpunkt 1","Stichpunkt 2",...]';
  }

  // Schritt 2: Gemini analysieren lassen
  try {
    var geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;

    var response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Gemini API Fehler:', response.status, errText);
      return res.status(500).json({ error: 'Gemini API Fehler: ' + response.status, detail: errText });
    }

    var data = await response.json();

    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({ error: 'Keine Antwort von Gemini', raw: JSON.stringify(data) });
    }

    var content = data.candidates[0].content.parts[0].text.trim();

    var results;
    try {
      var jsonMatch = content.match(/\[[\s\S]*\]/);
      results = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch (e) {
      results = content
        .split('\n')
        .map(function(l) { return l.replace(/^[-•*"\d.]\s*/, '').replace(/[",]$/, '').trim(); })
        .filter(function(l) { return l.length > 10; });
    }

    return res.status(200).json({ results: results });

  } catch (err) {
    console.error('Fehler:', err.message);
    return res.status(500).json({ error: 'Analyse fehlgeschlagen: ' + err.message });
  }
};
