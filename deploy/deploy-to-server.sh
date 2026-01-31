#!/bin/bash
# Remote deployment script
# Deploys Data Module Sports to production server (192.168.1.251)

set -e

# Server configuration
SERVER_USER="marmok"
SERVER_IP="192.168.1.251"
SERVER_PATH="/opt/data-module"

echo "🚀 Deploying Data Module Sports to $SERVER_IP"
echo "============================================="

# Check if we can connect to the server
echo "🔌 Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 $SERVER_USER@$SERVER_IP "echo 'Connected successfully'" &> /dev/null; then
    echo "❌ Error: Cannot connect to $SERVER_IP"
    echo "Check your SSH connection and try again"
    exit 1
fi

echo "✅ SSH connection successful"

# Create project directory on server
echo "📁 Creating project directory on server..."
ssh $SERVER_USER@$SERVER_IP "mkdir -p $SERVER_PATH"

# Sync project files (excluding node_modules, dist, logs)
echo "📦 Syncing project files..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'logs' \
    --exclude '.git' \
    --exclude 'backups' \
    --exclude '.env.production' \
    ./ $SERVER_USER@$SERVER_IP:$SERVER_PATH/

echo "✅ Files synced"

# Copy .env.production if it exists locally
if [ -f .env.production ]; then
    echo "🔐 Copying .env.production to server..."
    scp .env.production $SERVER_USER@$SERVER_IP:$SERVER_PATH/.env.production
    echo "✅ Environment variables copied"
else
    echo "⚠️  Warning: .env.production not found locally"
    echo "Make sure to create it on the server before running setup"
fi

# Copy secrets if they exist
if [ -d secrets ]; then
    echo "🔑 Copying secrets to server..."
    rsync -avz --progress secrets/ $SERVER_USER@$SERVER_IP:$SERVER_PATH/secrets/
    ssh $SERVER_USER@$SERVER_IP "chmod 700 $SERVER_PATH/secrets"
    echo "✅ Secrets copied"
else
    echo "⚠️  Warning: secrets directory not found"
fi

# Make scripts executable
echo "🔧 Making scripts executable..."
ssh $SERVER_USER@$SERVER_IP "chmod +x $SERVER_PATH/deploy/*.sh"

# Install Docker if not present
echo "🐳 Checking Docker installation..."
if ! ssh $SERVER_USER@$SERVER_IP "docker --version" &> /dev/null; then
    echo "📥 Installing Docker..."
    ssh $SERVER_USER@$SERVER_IP <<'EOF'
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        rm get-docker.sh
EOF
    echo "✅ Docker installed"
    echo "⚠️  Note: You may need to log out and back in for Docker permissions to take effect"
else
    echo "✅ Docker is already installed"
fi

# Install Docker Compose if not present
echo "🐳 Checking Docker Compose installation..."
if ! ssh $SERVER_USER@$SERVER_IP "docker compose version" &> /dev/null; then
    echo "📥 Installing Docker Compose..."
    ssh $SERVER_USER@$SERVER_IP <<'EOF'
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
EOF
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose is already installed"
fi

# Install Node.js and pnpm if not present
echo "📦 Checking Node.js installation..."
if ! ssh $SERVER_USER@$SERVER_IP "node --version" &> /dev/null; then
    echo "📥 Installing Node.js..."
    ssh $SERVER_USER@$SERVER_IP <<'EOF'
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
        sudo npm install -g pnpm@8
EOF
    echo "✅ Node.js and pnpm installed"
else
    echo "✅ Node.js is already installed"

    # Check pnpm
    if ! ssh $SERVER_USER@$SERVER_IP "pnpm --version" &> /dev/null; then
        echo "📥 Installing pnpm..."
        ssh $SERVER_USER@$SERVER_IP "sudo npm install -g pnpm@8"
        echo "✅ pnpm installed"
    fi
fi

echo ""
echo "============================================="
echo "✅ Deployment files copied to server!"
echo "============================================="
echo ""
echo "Next steps:"
echo ""
echo "1. SSH to the server:"
echo "   ssh $SERVER_USER@$SERVER_IP"
echo ""
echo "2. Navigate to project directory:"
echo "   cd $SERVER_PATH"
echo ""
echo "3. Review .env.production:"
echo "   nano .env.production"
echo ""
echo "4. Ensure secrets/kalshi-private-key.pem exists"
echo ""
echo "5. Run setup script:"
echo "   ./deploy/setup-production.sh"
echo ""
echo "6. Monitor deployment:"
echo "   docker compose -f docker-compose.production.yml logs -f"
echo ""
