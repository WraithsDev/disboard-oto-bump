const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs').promises;
const chalk = require('chalk');
const config = require('./config');

// Renkli log fonksiyonları
const log = {
    info: (message) => console.log(chalk.cyan(`[${chalk.white(new Date().toLocaleString('tr-TR'))}] [INFO] ${message}`)),
    success: (message) => console.log(chalk.green(`[${chalk.white(new Date().toLocaleString('tr-TR'))}] [SUCCESS] ${message}`)),
    error: (message) => console.log(chalk.red(`[${chalk.white(new Date().toLocaleString('tr-TR'))}] [ERROR] ${message}`)),
    warning: (message) => console.log(chalk.yellow(`[${chalk.white(new Date().toLocaleString('tr-TR'))}] [WARNING] ${message}`)),
    debug: (message) => console.log(chalk.magenta(`[${chalk.white(new Date().toLocaleString('tr-TR'))}] [DEBUG] ${message}`))
};

class Bot {
    constructor() {
        this.tokens = [];
        this.currentClientIndex = 0;
        this.problemTokens = new Set();
        this.checkInterval = 5 * 60 * 1000; // 5 dakika
        this.bumpInterval = 125 * 60 * 1000; // Disboard bump aralığı (2 saat 5 dakika)
        this.currentClient = null;
        this.isRunning = true;
        this.lastBumpTime = null;
    }

    async initialize() {
        try {
            const tokenData = await fs.readFile('tokens.txt', 'utf8');
            this.tokens = tokenData.split('\n').map(t => t.trim()).filter(t => t.length > 0);

            if (this.tokens.length === 0) {
                throw new Error('tokens.txt dosyasında geçerli token bulunamadı.');
            }

            log.info(`${this.tokens.length} adet token bulundu.`);

            try {
                const problemData = await fs.readFile('problem_tokens.txt', 'utf8');
                const problemTokensList = problemData.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                problemTokensList.forEach(line => {
                    const token = line.split(' - ')[0];
                    this.problemTokens.add(token);
                });
                log.warning(`${this.problemTokens.size} adet sorunlu token yüklendi.`);
            } catch (error) {
                log.info('Sorunlu tokenler yüklenemedi. Yeni dosya oluşturulacak.');
            }

            await this.startBumpCycle();
        } catch (error) {
            log.error(`Başlatma hatası: ${error.message}`);
            process.exit(1);
        }
    }

    async startBumpCycle() {
        log.info(`Bump döngüsü başlatılıyor. Her 5 dakikada bir kontrol edilecek.`);

        // Ctrl+C için güvenli kapanış
        process.on('SIGINT', async () => {
            log.info('👋 Program kapatılıyor...');
            this.isRunning = false;
            if (this.currentClient) {
                await this.currentClient.destroy();
                log.info(`${this.currentClient.user?.username || 'Bilinmeyen kullanıcı'} çıkış yaptı.`);
            }
            process.exit(0);
        });

        while (this.isRunning) {
            if (this.tokens.length === 0) {
                log.error('Kullanılabilir token kalmadı! Program sonlandırılıyor.');
                break;
            }

            await this.checkAndBump();
            if (this.isRunning) {
                log.info(`Kontrol tamamlandı. Bir sonraki kontrol için 5 dakika bekleniyor...`);
                await new Promise(resolve => setTimeout(resolve, this.checkInterval));
            }
        }
    }

    async checkAndBump() {
        log.info(`Kontrol mesajı: Sistem çalışıyor - Token sırası: ${this.currentClientIndex + 1}/${this.tokens.length}`);
        
        let token = this.tokens[this.currentClientIndex];

        // Sorunlu token kontrolü
        while (this.problemTokens.has(token) && this.isRunning) {
            log.warning(`Token ${this.currentClientIndex + 1} sorunlu, atlanıyor.`);
            this.currentClientIndex = (this.currentClientIndex + 1) % this.tokens.length;
            token = this.tokens[this.currentClientIndex];
            if (this.currentClientIndex === 0) {
                log.info('Tüm tokenler kontrol edildi, döngü başa dönüyor.');
            }
        }

        // İstemci yoksa veya bağlantı kopmuşsa, yeni istemci oluştur
        if (!this.currentClient || !this.currentClient.isReady()) {
            if (this.currentClient) {
                await this.currentClient.destroy();
                log.info(`${this.currentClient.user?.username || 'Bilinmeyen kullanıcı'} çıkış yaptı.`);
            }
            this.currentClient = new Client({ checkUpdate: false });
            try {
                await this.currentClient.login(token);
                log.success(`${this.currentClient.user.username} (${this.currentClient.user.id}) giriş yaptı!`);

                // Bağlantı kopması durumunda yeniden bağlanmayı dene
                this.currentClient.on('error', async (error) => {
                    log.error(`İstemci hatası (Token ${this.currentClientIndex + 1}): ${error.message}`);
                    await this.recordProblemToken(token, error.message);
                    await this.switchToNextToken();
                    if (this.isRunning) {
                        await this.checkAndBump();
                    }
                });
            } catch (error) {
                log.error(`Hata (Token ${this.currentClientIndex + 1}): ${error.message}`);
                await this.recordProblemToken(token, error.message);
                await this.switchToNextToken();
                return;
            }
        }

        try {
            const channel = this.currentClient.channels.cache.get(config.channelId);
            if (!channel) {
                throw new Error(`Kanal bulunamadı (ID: ${config.channelId})`);
            }

            const messages = await channel.messages.fetch({ limit: 100 });
            let lastBumpMessage = null;

            for (const message of messages.values()) {
                if (message.author.id === config.disboardBotId) {
                    const embed = message.embeds[0];
                    if (embed && embed.description?.includes('Öne çıkarma başarılı!')) {
                        lastBumpMessage = message;
                        this.lastBumpTime = message.createdTimestamp;
                        log.debug(`Son bump: ${new Date(message.createdTimestamp).toLocaleString('tr-TR')}`);
                        break;
                    }
                }
            }

            let canBump = true;
            if (lastBumpMessage) {
                const timeSinceLastBump = Date.now() - lastBumpMessage.createdTimestamp;
                canBump = timeSinceLastBump >= this.bumpInterval;
                if (!canBump) {
                    const remainingTime = Math.ceil((this.bumpInterval - timeSinceLastBump) / 60000);
                    log.info(`Bump için kalan süre: ${remainingTime} dakika`);
                }
            }

            if (canBump) {
                log.info(`${this.currentClient.user.username} için /bump komutu gönderiliyor...`);
                await channel.sendSlash(config.disboardBotId, 'bump');

                const responseFilter = m => m.author.id === config.disboardBotId && m.embeds.length > 0;
                const collected = await channel.awaitMessages({
                    filter: responseFilter,
                    max: 1,
                    time: 10000,
                    errors: ['time']
                }).catch(() => null);

                if (collected && collected.size > 0) {
                    const response = collected.first();
                    const embed = response.embeds[0];
                    if (embed.description?.includes('Öne çıkarma başarılı!')) {
                        log.success(`${this.currentClient.user.username} bump attı!`);
                        await this.switchToNextToken();
                    } else {
                        log.warning(`Bump başarısız: ${embed.description}`);
                    }
                } else {
                    log.warning(`Disboard yanıt vermedi.`);
                    await this.switchToNextToken(); // 💡 Buraya eklendi!
                }
            }
        } catch (error) {
            log.error(`Hata (Token ${this.currentClientIndex + 1}): ${error.message}`);
            await this.recordProblemToken(token, error.message);
            await this.switchToNextToken();
        }
    }

    async switchToNextToken() {
        if (this.currentClient) {
            try {
                await this.currentClient.destroy();
                log.info(`${this.currentClient.user?.username || 'Bilinmeyen kullanıcı'} çıkış yaptı.`);
            } catch (error) {
                log.error(`İstemci kapatılamadı: ${error.message}`);
            }
            this.currentClient = null;
        }

        this.currentClientIndex = (this.currentClientIndex + 1) % this.tokens.length;
        if (this.currentClientIndex === 0) {
            log.info('Tüm tokenler kullanıldı, döngü başa dönüyor.');
        }
    }

    async recordProblemToken(token, reason) {
        if (!token) return;
        this.problemTokens.add(token);
        await fs.appendFile('problem_tokens.txt', `${token} - ${reason}\n`);
        log.warning(`Sorunlu token kaydedildi: ${this.maskToken(token)}`);
    }

    maskToken(token) {
        if (!token) return 'Bilinmeyen Token';
        return token.substring(0, 6) + '...' + token.substring(token.length - 6);
    }

    async start() {
        await this.initialize();
    }
}

module.exports = Bot;
