const Bot = require('./bot');
const chalk = require('chalk');
const figlet = require('figlet');

(async () => {
    const gradient = await import('gradient-string');

    console.clear();
    console.log(chalk.green('='.repeat(60)));
    console.log(
        gradient.default.rainbow(
            figlet.textSync('ONUR CAN', {
                font: 'Fire Font-K',
                horizontalLayout: 'default',
                verticalLayout: 'default'
            })
        )
    );
    console.log(gradient.default.pastel('               DİSBOARD TOOL'));
    console.log(chalk.green('='.repeat(60)));

    const bot = new Bot();
    bot.start().catch(err => {
        console.error(chalk.red('💥 Kritik hata:'), err);
        process.exit(1);
    });

    process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n👋 Program kapatılıyor...'));
        process.exit(0);
    });
})();