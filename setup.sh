#!/bin/bash

# YouTube Insight Hub - Quick Setup

echo "🎬 YouTube Insight Hub Setup"
echo "=============================="
echo ""

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local not found!"
    echo "Please create .env.local with your Groq API key:"
    echo ""
    echo "NEXT_PUBLIC_GROQ_API_KEY=your_groq_api_key_here"
    echo ""
    echo "Get your free API key from: https://console.groq.com/keys"
    exit 1
fi

# Check if Groq API key is set
if grep -q "your_groq_api_key_here" .env.local; then
    echo "❌ Groq API key not configured!"
    echo "Please edit .env.local and replace 'your_groq_api_key_here' with your actual API key"
    echo "Get your key from: https://console.groq.com/keys"
    exit 1
fi

echo "✅ Configuration looks good!"
echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the development server, run:"
echo "  npm run dev"
echo ""
echo "Then open http://localhost:3000 in your browser"
