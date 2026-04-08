{
  "version": 2,
  "builds": [
    { "src": "api/sofortanalyse.js", "use": "@vercel/node" }
  ],
  "routes": [
    {
      "src": "/api/sofortanalyse",
      "dest": "/api/sofortanalyse.js",
      "methods": ["POST", "OPTIONS"],
      "headers": {
        "Access-Control-Allow-Origin": "*"
      }
    }
  ]
}
