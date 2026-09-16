export type Language = 'pt' | 'en' | 'es'

export const translations = {
  pt: {
    brand: 'SaveTube',
    header: {
      searchPlaceholder: 'Pesquisar',
      credits: '{{count}} crédito',
      credits_plural: '{{count}} créditos',
      buyCredits: 'Comprar créditos'
    },
    languageSelector: {
      label: 'Idioma',
      pt: 'Português',
      en: 'English',
      es: 'Español'
    },
    hero: {
      title: 'Baixe vídeos do YouTube',
      subtitle: 'Cole o link, escolha o formato e salve seu vídeo em segundos. Grátis até 720p (3 por dia) ou use 1 crédito por download em alta resolução.',
      urlPlaceholder: 'https://www.youtube.com/watch?v=...',
      analyze: 'Analisar',
      voucherPlaceholder: 'Cole seu voucher STB-XXXX-XXXX-XXXX',
      redeem: 'Resgatar'
    },
    restrictions: {
      title: 'O que funciona?',
      works: 'Vídeos públicos do YouTube sem restrição de idade.',
      doesntTitle: 'O que não funciona?',
      doesnt: 'Vídeos privados, removidos, com restrição de idade (+18), exigindo login, bloqueados em sua região ou transmissões ao vivo.'
    },
    preview: {
      title: 'Pré-visualização',
      unknownChannel: 'Canal desconhecido',
      min: 'min'
    },
    controls: {
      title: 'Configurações',
      statusReady: 'Pronto para começar',
      statusAnalyzing: 'Analisando link…',
      statusPreparing: 'Preparando download…',
      videoFormat: 'Formato de vídeo',
      bestQuality: 'Melhor qualidade',
      audioOnly: 'Baixar apenas o áudio (MP3)',
      useCredit: 'Usar 1 crédito para este download (ignora o limite de 3 grátis)',
      creditNeeded: 'Este formato consome 1 crédito (um download em alta resolução). Saldo: {{balance}}.',
      downloadFree: 'Baixar grátis',
      downloadWithCredit: 'Baixar — 1 crédito',
      processing: 'Processando…',
      statusCancelled: 'Processo cancelado',
      cancel: 'Cancelar',
      cancelling: 'Cancelando…',
      optionLabel: '{{height}}p · {{ext}} {{size}} {{tag}}',
      freeTag: '(grátis)',
      creditTag: '(1 crédito)',
      mp3Label: 'MP3'
    },
    progress: {
      analyzing: 'Analisando…',
      downloading: 'Baixando…',
      preparing: 'Preparando download…',
      converting: 'Convertendo para MP3…',
      speed: 'Velocidade',
      downloaded: 'Baixado',
      total: 'Total',
      eta: 'ETA',
      seconds: 's',
      finished: 'Download concluído',
      analysisFinished: 'Análise concluída'
    },
    errors: {
      serverUnavailable: 'Servidor indisponível. Recarregue a página.',
      ageRestricted: 'Este vídeo tem restrição de idade ou exige login no YouTube. No momento, o SaveTube não consegue processar vídeos restritos. Tente outro link público.',
      ffmpeg: 'Erro de processamento de áudio/vídeo. Entre em contato pelo WhatsApp se o problema continuar.',
      fragment: 'O download falhou após várias tentativas. O vídeo pode estar indisponível ou com restrições regionais. Tente novamente mais tarde.',
      private: 'Vídeo privado, removido ou indisponível. Verifique o link e tente outro.',
      livestream: 'Este vídeo é uma transmissão ao vivo. O SaveTube não suporta download de lives. Aguarde o vídeo ficar gravado no YouTube e tente novamente.',
      generic: 'Não foi possível iniciar',
      network: 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.',
      needCredit: 'Você precisa de 1 crédito para este download. Compre pelo botão Comprar créditos.',
      redeem: 'Erro ao resgatar voucher'
    },
    success: {
      creditsAdded: '{{count}} crédito(s) adicionado(s) ao seu saldo!'
    },
    donationBanner: {
      title: 'Doe qualquer valor 💚',
      globalTitle: 'Apoie o SaveTube 💚',
      pixOnly: 'Disponível apenas no Brasil',
      chooseMethodBR: 'Escolha como quer doar:',
      chooseMethodGlobal: 'Escolha como quer doar:',
      cryptoLabel: 'Criptomoeda',
      paypalButton: 'Doar com PayPal',
      copyKey: 'Copiar endereço',
      compactLabel: 'Gostou? Apoie o SaveTube:'
    },
    pricing: {
      title: 'Escolha como quer usar',
      free: {
        title: 'Grátis',
        price: '{{symbol}} 0',
        period: '/ sempre',
        features: [
          'Até 720p e áudio MP3',
          '3 downloads por dia',
          'Controle automático por IP',
          'Download no seu navegador'
        ],
        cta: 'Usar grátis'
      },
      credits: {
        title: 'Créditos SaveTube',
        price: '{{price}}',
        period: '/ crédito',
        features: [
          '1 crédito = 1 download em alta resolução',
          '1080p, 2K e 4K',
          'Download em nosso servidor',
          'Link rápido de download',
          'Sem limite diário'
        ],
        cta: 'Comprar créditos'
      }
    },
    howItWorks: {
      title: 'Como baixar vídeos do YouTube',
      steps: [
        { title: '1. Cole o link', text: 'Copie a URL do vídeo do YouTube e cole no campo acima. Funciona com links normais, shorts e playlists (primeiro vídeo).' },
        { title: '2. Escolha o formato', text: 'Selecione entre MP3 (somente áudio) ou MP4 em várias resoluções. Até 720p é grátis; acima disso usa 1 crédito.' },
        { title: '3. Baixe', text: 'Clique em baixar e acompanhe o progresso. Os arquivos ficam prontos em segundos, direto no seu navegador ou em nosso servidor.' }
      ]
    },
    whyUse: {
      title: 'Por que usar o SaveTube?',
      items: [
        { strong: 'Rápido e online:', text: 'não precisa instalar programas.' },
        { strong: 'Grátis para uso básico:', text: '3 downloads por dia em até 720p.' },
        { strong: 'Alta qualidade:', text: 'MP3 e resoluções até 4K com créditos.' },
        { strong: 'Sem anúncios invasivos:', text: 'mantido por doações e créditos.' }
      ]
    },
    faq: {
      title: 'Perguntas frequentes',
      items: [
        { q: 'O SaveTube é grátis?', a: 'Sim. Você pode baixar até 3 vídeos por dia em até 720p ou como MP3 sem pagar nada. Para resoluções maiores, use créditos.' },
        { q: 'Como comprar créditos?', a: 'Clique em "Comprar créditos", escolha a quantidade, pague via Pix ou PayPal e envie o comprovante pelo WhatsApp. Você receberá um voucher para resgatar.' },
        { q: 'Posso baixar áudio do YouTube?', a: 'Sim. Basta marcar a opção "Baixar apenas o áudio (MP3)" antes de iniciar o download.' },
        { q: 'Por que alguns vídeos não funcionam?', a: 'Vídeos privados, removidos, com restrição de idade (+18) ou bloqueados na sua região não podem ser processados.' },
        { q: 'Os créditos expiram?', a: 'Os créditos ficam salvos no seu navegador. Recomendamos usá-los em até 12 meses.' }
      ]
    },
    footer: {
      terms: 'Termos de uso',
      privacy: 'Privacidade',
      support: 'Apoie o projeto',
      mp3: 'YouTube para MP3',
      mp4: 'YouTube para MP4',
      copyright: '© {{year}} SaveTube. Projeto independente mantido por doações.'
    },
    donateModal: {
      title: 'Comprar créditos SaveTube',
      lead: 'Cada crédito libera um download em alta resolução (1080p, 2K ou 4K) no nosso servidor. Escolha uma forma de pagamento, envie o comprovante pelo WhatsApp e receba seu voucher com os créditos.',
      quantity: 'Quantidade de créditos',
      total: 'Total',
      summary: '{{quantity}} crédito × {{symbol}} {{price}}',
      summary_plural: '{{quantity}} créditos × {{symbol}} {{price}}',
      empty: 'Nenhuma forma de pagamento configurada ainda.',
      paypalHint: 'Para receber pelo PayPal sem usar doação, crie seu link em paypal.com/paypalme e cadastre-o aqui (ex: paypal.me/seunome).',
      pix: {
        copyKey: 'Copiar chave',
        copyCode: 'Copiar código Pix'
      },
      crypto: {
        copyAddress: 'Copiar endereço'
      },
      paypalButton: 'Pagar {{symbol}} {{total}} com PayPal',
      genericButton: 'Pagar {{symbol}} {{total}} com {{name}}',
      whatsappHint: 'Após pagar, clique no botão abaixo e envie apenas o comprovante. Não é necessário explicar: basta o print.',
      whatsappButton: 'Enviar comprovante pelo WhatsApp',
      poweredBy: 'Com tecnologia'
    },
    auth: {
      title: 'Entrar com e-mail',
      emailLabel: 'Seu e-mail',
      emailPlaceholder: 'voce@exemplo.com',
      sendCode: 'Enviar código',
      codeLabel: 'Código de confirmação',
      codePlaceholder: '000000',
      confirm: 'Confirmar código',
      back: 'Voltar',
      codeSent: 'Código enviado! Confira sua caixa de entrada (e o spam).',
      devCode: 'Modo dev — código: {{code}}',
      invalidEmail: 'E-mail inválido',
      needLogin: 'Entre com seu e-mail para usar créditos.',
      genericError: 'Erro ao autenticar. Tente novamente.',
      logout: 'Sair',
      loggedAs: 'Conta'
    },
    admin: {
      title: 'SaveTube Admin',
      passwordPlaceholder: 'Senha de administrador',
      login: 'Entrar',
      logout: 'Sair',
      wrongPassword: 'Senha incorreta',
      loading: 'Carregando…',
      stats: {
        title: 'Estatísticas',
        created: 'Vouchers criados',
        redeemed: 'Vouchers resgatados',
        freeToday: 'Downloads grátis hoje'
      },
      generate: {
        title: 'Gerar vouchers',
        amount: 'Quantidade',
        credits: 'Créditos por voucher',
        button: 'Gerar',
        generated: 'Vouchers gerados:',
        copyAll: 'Copiar todos'
      },
      vouchers: {
        title: 'Vouchers existentes',
        code: 'Código',
        credits: 'Créditos',
        status: 'Status',
        date: 'Data',
        redeemed: 'Resgatado em {{date}}',
        active: 'Ativo'
      },
      config: {
        title: 'Configurações de doação',
        creditPrice: 'Preço do crédito ({{currency}})',
        whatsapp: 'WhatsApp (apenas números)',
        methodsTitle: 'Métodos de pagamento',
        add: '+ Adicionar método',
        save: 'Salvar configurações',
        namePlaceholder: 'Nome',
        valuePlaceholder: 'URL / chave / usuário',
        active: 'Ativo',
        remove: 'Remover',
        region: 'Região',
        exchangeRate: 'Taxa de câmbio BRL → USD',
        defaultPricePreview: 'Preço global calculado',
        regions: {
          BR: 'Brasil (BRL)',
          default: 'Global (USD)',
          all: 'Todas as regiões'
        },
        types: {
          link: 'Link genérico',
          qrcode: 'QR Code (URL)',
          crypto: 'Criptomoeda'
        }
      },
      errors: {
        html: 'Servidor retornou uma página HTML em vez de JSON. Verifique se o backend está rodando.',
        unexpected: 'Resposta inesperada',
        session: 'Sessão inválida',
        load: 'Erro ao carregar',
        login: 'Erro ao entrar',
        generate: 'Erro ao gerar vouchers',
        save: 'Erro ao salvar config'
      },
      cookies: {
        title: 'Cookies do YouTube',
        description: 'Para baixar vídeos com restrição de idade, o sistema precisa de cookies de uma conta do YouTube logada. Configure YOUTUBE_EMAIL e YOUTUBE_PASSWORD no arquivo .env e clique em Atualizar cookies.',
        active: 'Cookies ativos ({{size}} bytes)',
        inactive: 'Cookies inativos ({{size}} bytes)',
        refresh: 'Atualizar cookies',
        error: 'Erro ao atualizar cookies',
        updating: 'Atualizando…'
      }
    }
  },
  en: {
    brand: 'SaveTube',
    header: {
      searchPlaceholder: 'Search',
      credits: '{{count}} credit',
      credits_plural: '{{count}} credits',
      buyCredits: 'Buy credits'
    },
    languageSelector: {
      label: 'Language',
      pt: 'Português',
      en: 'English',
      es: 'Español'
    },
    hero: {
      title: 'Download YouTube videos',
      subtitle: 'Paste the link, choose the format and save your video in seconds. Free up to 720p (3 per day) or use 1 credit per high-resolution download.',
      urlPlaceholder: 'https://www.youtube.com/watch?v=...',
      analyze: 'Analyze',
      voucherPlaceholder: 'Paste your voucher STB-XXXX-XXXX-XXXX',
      redeem: 'Redeem'
    },
    restrictions: {
      title: 'What works?',
      works: 'Public YouTube videos without age restriction.',
      doesntTitle: 'What does not work?',
      doesnt: 'Private, removed, age-restricted (+18), login-required, region-blocked videos or live streams.'
    },
    preview: {
      title: 'Preview',
      unknownChannel: 'Unknown channel',
      min: 'min'
    },
    controls: {
      title: 'Settings',
      statusReady: 'Ready to start',
      statusAnalyzing: 'Analyzing link…',
      statusPreparing: 'Preparing download…',
      videoFormat: 'Video format',
      bestQuality: 'Best quality',
      audioOnly: 'Download audio only (MP3)',
      useCredit: 'Use 1 credit for this download (ignores the 3 free daily limit)',
      creditNeeded: 'This format uses 1 credit (one high-resolution download). Balance: {{balance}}.',
      downloadFree: 'Download free',
      downloadWithCredit: 'Download — 1 credit',
      processing: 'Processing…',
      statusCancelled: 'Process cancelled',
      cancel: 'Cancel',
      cancelling: 'Cancelling…',
      optionLabel: '{{height}}p · {{ext}} {{size}} {{tag}}',
      freeTag: '(free)',
      creditTag: '(1 credit)',
      mp3Label: 'MP3'
    },
    progress: {
      analyzing: 'Analyzing…',
      downloading: 'Downloading…',
      preparing: 'Preparing download…',
      converting: 'Converting to MP3…',
      speed: 'Speed',
      downloaded: 'Downloaded',
      total: 'Total',
      eta: 'ETA',
      seconds: 's',
      finished: 'Download complete',
      analysisFinished: 'Analysis complete'
    },
    errors: {
      serverUnavailable: 'Server unavailable. Please reload the page.',
      ageRestricted: 'This video is age-restricted or requires YouTube login. SaveTube cannot process restricted videos right now. Try another public link.',
      ffmpeg: 'Audio/video processing error. Contact us on WhatsApp if the problem persists.',
      fragment: 'Download failed after several attempts. The video may be unavailable or region-restricted. Please try again later.',
      private: 'Private, removed or unavailable video. Check the link and try another one.',
      livestream: 'This video is a live stream. SaveTube does not support downloading live streams. Wait until the video is recorded on YouTube and try again.',
      generic: 'Could not start',
      network: 'Could not connect to the server. Check your internet connection and try again.',
      needCredit: 'You need 1 credit for this download. Buy credits using the Buy credits button.',
      redeem: 'Error redeeming voucher'
    },
    success: {
      creditsAdded: '{{count}} credit(s) added to your balance!'
    },
    donationBanner: {
      title: 'Donate any amount 💚',
      globalTitle: 'Support SaveTube 💚',
      pixOnly: 'Brazil only',
      chooseMethodBR: 'Choose how to donate:',
      chooseMethodGlobal: 'Choose how to donate:',
      cryptoLabel: 'Cryptocurrency',
      paypalButton: 'Donate with PayPal',
      copyKey: 'Copy address',
      compactLabel: 'Like it? Support SaveTube:'
    },
    pricing: {
      title: 'Choose how to use',
      free: {
        title: 'Free',
        price: '{{symbol}} 0',
        period: '/ forever',
        features: [
          'Up to 720p and MP3 audio',
          '3 downloads per day',
          'Automatic IP limit',
          'Download in your browser'
        ],
        cta: 'Use free'
      },
      credits: {
        title: 'SaveTube Credits',
        price: '{{price}}',
        period: '/ credit',
        features: [
          '1 credit = 1 high-resolution download',
          '1080p, 2K and 4K',
          'Download on our server',
          'Fast download link',
          'No daily limit'
        ],
        cta: 'Buy credits'
      }
    },
    howItWorks: {
      title: 'How to download YouTube videos',
      steps: [
        { title: '1. Paste the link', text: 'Copy the YouTube video URL and paste it above. Works with normal links, shorts and playlists (first video).' },
        { title: '2. Choose the format', text: 'Choose between MP3 (audio only) or MP4 in several resolutions. Up to 720p is free; above that uses 1 credit.' },
        { title: '3. Download', text: 'Click download and follow the progress. Files are ready in seconds, directly in your browser or on our server.' }
      ]
    },
    whyUse: {
      title: 'Why use SaveTube?',
      items: [
        { strong: 'Fast and online:', text: 'no need to install programs.' },
        { strong: 'Free for basic use:', text: '3 downloads per day up to 720p.' },
        { strong: 'High quality:', text: 'MP3 and resolutions up to 4K with credits.' },
        { strong: 'No invasive ads:', text: 'supported by donations and credits.' }
      ]
    },
    faq: {
      title: 'Frequently asked questions',
      items: [
        { q: 'Is SaveTube free?', a: 'Yes. You can download up to 3 videos per day up to 720p or as MP3 for free. For higher resolutions, use credits.' },
        { q: 'How do I buy credits?', a: 'Click "Buy credits", choose the quantity, pay via PayPal or Stripe and send the receipt via WhatsApp. You will receive a voucher to redeem.' },
        { q: 'Can I download YouTube audio?', a: 'Yes. Just check "Download audio only (MP3)" before starting the download.' },
        { q: 'Why do some videos not work?', a: 'Private, removed, age-restricted (+18) or region-blocked videos cannot be processed.' },
        { q: 'Do credits expire?', a: 'Credits are saved in your browser. We recommend using them within 12 months.' }
      ]
    },
    footer: {
      terms: 'Terms of use',
      privacy: 'Privacy',
      support: 'Support the project',
      mp3: 'YouTube to MP3',
      mp4: 'YouTube to MP4',
      downloader: 'YouTube Downloader',
      copyright: '© {{year}} SaveTube. Independent project supported by donations.'
    },
    donateModal: {
      title: 'Buy SaveTube credits',
      lead: 'Each credit unlocks one high-resolution download (1080p, 2K or 4K) on our server. Choose a payment method, send the receipt via WhatsApp and receive your voucher with the credits.',
      quantity: 'Quantity of credits',
      total: 'Total',
      summary: '{{quantity}} credit × {{symbol}} {{price}}',
      summary_plural: '{{quantity}} credits × {{symbol}} {{price}}',
      empty: 'No payment method configured yet.',
      paypalHint: 'To receive via PayPal without using a donation link, create your link at paypal.com/paypalme and register it here (e.g. paypal.me/yourname).',
      pix: {
        copyKey: 'Copy key',
        copyCode: 'Copy Pix code'
      },
      crypto: {
        copyAddress: 'Copy address'
      },
      paypalButton: 'Pay {{symbol}} {{total}} with PayPal',
      genericButton: 'Pay {{symbol}} {{total}} with {{name}}',
      whatsappHint: 'After paying, click the button below and send only the receipt. No need to explain: just the screenshot.',
      whatsappButton: 'Send receipt via WhatsApp',
      poweredBy: 'Powered by'
    },
    auth: {
      title: 'Sign in with email',
      emailLabel: 'Your email',
      emailPlaceholder: 'you@example.com',
      sendCode: 'Send code',
      codeLabel: 'Confirmation code',
      codePlaceholder: '000000',
      confirm: 'Confirm code',
      back: 'Back',
      codeSent: 'Code sent! Check your inbox (and spam).',
      devCode: 'Dev mode — code: {{code}}',
      invalidEmail: 'Invalid email',
      needLogin: 'Sign in with your email to use credits.',
      genericError: 'Authentication error. Try again.',
      logout: 'Sign out',
      loggedAs: 'Account'
    },
    admin: {
      title: 'SaveTube Admin',
      passwordPlaceholder: 'Administrator password',
      login: 'Login',
      logout: 'Logout',
      wrongPassword: 'Wrong password',
      loading: 'Loading…',
      stats: {
        title: 'Statistics',
        created: 'Vouchers created',
        redeemed: 'Vouchers redeemed',
        freeToday: 'Free downloads today'
      },
      generate: {
        title: 'Generate vouchers',
        amount: 'Quantity',
        credits: 'Credits per voucher',
        button: 'Generate',
        generated: 'Generated vouchers:',
        copyAll: 'Copy all'
      },
      vouchers: {
        title: 'Existing vouchers',
        code: 'Code',
        credits: 'Credits',
        status: 'Status',
        date: 'Date',
        redeemed: 'Redeemed on {{date}}',
        active: 'Active'
      },
      config: {
        title: 'Payment settings',
        creditPrice: 'Credit price ({{currency}})',
        whatsapp: 'WhatsApp (numbers only)',
        methodsTitle: 'Payment methods',
        add: '+ Add method',
        save: 'Save settings',
        namePlaceholder: 'Name',
        valuePlaceholder: 'URL / key / username',
        active: 'Active',
        remove: 'Remove',
        region: 'Region',
        exchangeRate: 'BRL → USD exchange rate',
        defaultPricePreview: 'Calculated global price',
        regions: {
          BR: 'Brazil (BRL)',
          default: 'Global (USD)',
          all: 'All regions'
        },
        types: {
          link: 'Generic link',
          qrcode: 'QR Code (URL)',
          crypto: 'Cryptocurrency'
        }
      },
      errors: {
        html: 'Server returned an HTML page instead of JSON. Check if the backend is running.',
        unexpected: 'Unexpected response',
        session: 'Invalid session',
        load: 'Error loading data',
        login: 'Error logging in',
        generate: 'Error generating vouchers',
        save: 'Error saving settings'
      },
      cookies: {
        title: 'YouTube cookies',
        description: 'To download age-restricted videos, the system needs cookies from a logged-in YouTube account. Configure YOUTUBE_EMAIL and YOUTUBE_PASSWORD in the .env file and click Update cookies.',
        active: 'Cookies active ({{size}} bytes)',
        inactive: 'Cookies inactive ({{size}} bytes)',
        refresh: 'Update cookies',
        error: 'Error updating cookies',
        updating: 'Updating…'
      }
    }
  },
  es: {
    brand: 'SaveTube',
    header: {
      searchPlaceholder: 'Buscar',
      credits: '{{count}} crédito',
      credits_plural: '{{count}} créditos',
      buyCredits: 'Comprar créditos'
    },
    languageSelector: {
      label: 'Idioma',
      pt: 'Português',
      en: 'English',
      es: 'Español'
    },
    hero: {
      title: 'Descarga videos de YouTube',
      subtitle: 'Pega el enlace, elige el formato y guarda tu video en segundos. Gratis hasta 720p (3 por día) o usa 1 crédito por descarga en alta resolución.',
      urlPlaceholder: 'https://www.youtube.com/watch?v=...',
      analyze: 'Analizar',
      voucherPlaceholder: 'Pega tu voucher STB-XXXX-XXXX-XXXX',
      redeem: 'Canjear'
    },
    restrictions: {
      title: '¿Qué funciona?',
      works: 'Videos públicos de YouTube sin restricción de edad.',
      doesntTitle: '¿Qué no funciona?',
      doesnt: 'Videos privados, eliminados, con restricción de edad (+18), que requieran inicio de sesión, bloqueados en tu región o transmisiones en vivo.'
    },
    preview: {
      title: 'Vista previa',
      unknownChannel: 'Canal desconocido',
      min: 'min'
    },
    controls: {
      title: 'Configuración',
      statusReady: 'Listo para comenzar',
      statusAnalyzing: 'Analizando enlace…',
      statusPreparing: 'Preparando descarga…',
      videoFormat: 'Formato de video',
      bestQuality: 'Mejor calidad',
      audioOnly: 'Descargar solo audio (MP3)',
      useCredit: 'Usar 1 crédito para esta descarga (ignora el límite de 3 gratis)',
      creditNeeded: 'Este formato consume 1 crédito (una descarga en alta resolución). Saldo: {{balance}}.',
      downloadFree: 'Descargar gratis',
      downloadWithCredit: 'Descargar — 1 crédito',
      processing: 'Procesando…',
      statusCancelled: 'Proceso cancelado',
      cancel: 'Cancelar',
      cancelling: 'Cancelando…',
      optionLabel: '{{height}}p · {{ext}} {{size}} {{tag}}',
      freeTag: '(gratis)',
      creditTag: '(1 crédito)',
      mp3Label: 'MP3'
    },
    progress: {
      analyzing: 'Analizando…',
      downloading: 'Descargando…',
      preparing: 'Preparando descarga…',
      converting: 'Convirtiendo a MP3…',
      speed: 'Velocidad',
      downloaded: 'Descargado',
      total: 'Total',
      eta: 'ETA',
      seconds: 's',
      finished: 'Descarga completa',
      analysisFinished: 'Análisis completo'
    },
    errors: {
      serverUnavailable: 'Servidor no disponible. Recarga la página.',
      ageRestricted: 'Este video tiene restricción de edad o requiere iniciar sesión en YouTube. SaveTube no puede procesar videos restringidos en este momento. Prueba con otro enlace público.',
      ffmpeg: 'Error de procesamiento de audio/video. Contáctanos por WhatsApp si el problema persiste.',
      fragment: 'La descarga falló después de varios intentos. El video puede no estar disponible o tener restricciones regionales. Inténtalo más tarde.',
      private: 'Video privado, eliminado o no disponible. Verifica el enlace y prueba otro.',
      livestream: 'Este video es una transmisión en vivo. SaveTube no admite descargar transmisiones en vivo. Espera a que el video quede grabado en YouTube e inténtalo de nuevo.',
      generic: 'No se pudo iniciar',
      network: 'No se pudo conectar al servidor. Verifica tu conexión a internet e inténtalo de nuevo.',
      needCredit: 'Necesitas 1 crédito para esta descarga. Compra créditos con el botón Comprar créditos.',
      redeem: 'Error al canjear el voucher'
    },
    success: {
      creditsAdded: '¡{{count}} crédito(s) añadido(s) a tu saldo!'
    },
    donationBanner: {
      title: 'Dona cualquier cantidad 💚',
      globalTitle: 'Apoya a SaveTube 💚',
      pixOnly: 'Solo disponible en Brasil',
      chooseMethodBR: 'Elige cómo donar:',
      chooseMethodGlobal: 'Elige cómo donar:',
      cryptoLabel: 'Criptomoneda',
      paypalButton: 'Donar con PayPal',
      copyKey: 'Copiar dirección',
      compactLabel: '¿Te gustó? Apoya a SaveTube:'
    },
    pricing: {
      title: 'Elige cómo usar',
      free: {
        title: 'Gratis',
        price: '{{symbol}} 0',
        period: '/ siempre',
        features: [
          'Hasta 720p y audio MP3',
          '3 descargas por día',
          'Control automático por IP',
          'Descarga en tu navegador'
        ],
        cta: 'Usar gratis'
      },
      credits: {
        title: 'Créditos SaveTube',
        price: '{{price}}',
        period: '/ crédito',
        features: [
          '1 crédito = 1 descarga en alta resolución',
          '1080p, 2K y 4K',
          'Descarga en nuestro servidor',
          'Enlace de descarga rápido',
          'Sin límite diario'
        ],
        cta: 'Comprar créditos'
      }
    },
    howItWorks: {
      title: 'Cómo descargar videos de YouTube',
      steps: [
        { title: '1. Pega el enlace', text: 'Copia la URL del video de YouTube y pégala arriba. Funciona con enlaces normales, shorts y listas de reproducción (primer video).' },
        { title: '2. Elige el formato', text: 'Elige entre MP3 (solo audio) o MP4 en varias resoluciones. Hasta 720p es gratis; por encima usa 1 crédito.' },
        { title: '3. Descarga', text: 'Haz clic en descargar y sigue el progreso. Los archivos están listos en segundos, directamente en tu navegador o en nuestro servidor.' }
      ]
    },
    whyUse: {
      title: '¿Por qué usar SaveTube?',
      items: [
        { strong: 'Rápido y online:', text: 'no necesitas instalar programas.' },
        { strong: 'Gratis para uso básico:', text: '3 descargas por día hasta 720p.' },
        { strong: 'Alta calidad:', text: 'MP3 y resoluciones hasta 4K con créditos.' },
        { strong: 'Sin anuncios invasivos:', text: 'mantenido por donaciones y créditos.' }
      ]
    },
    faq: {
      title: 'Preguntas frecuentes',
      items: [
        { q: '¿SaveTube es gratis?', a: 'Sí. Puedes descargar hasta 3 videos por día hasta 720p o como MP3 gratis. Para resoluciones mayores, usa créditos.' },
        { q: '¿Cómo compro créditos?', a: 'Haz clic en "Comprar créditos", elige la cantidad, paga por PayPal o Stripe y envía el comprobante por WhatsApp. Recibirás un voucher para canjear.' },
        { q: '¿Puedo descargar audio de YouTube?', a: 'Sí. Solo marca la opción "Descargar solo audio (MP3)" antes de iniciar la descarga.' },
        { q: '¿Por qué algunos videos no funcionan?', a: 'No se pueden procesar videos privados, eliminados, con restricción de edad (+18) o bloqueados en tu región.' },
        { q: '¿Los créditos expiran?', a: 'Los créditos se guardan en tu navegador. Recomendamos usarlos dentro de 12 meses.' }
      ]
    },
    footer: {
      terms: 'Términos de uso',
      privacy: 'Privacidad',
      support: 'Apoyar el proyecto',
      mp3: 'YouTube a MP3',
      mp4: 'YouTube a MP4',
      downloader: 'Descargar videos de YouTube',
      copyright: '© {{year}} SaveTube. Proyecto independiente mantenido por donaciones.'
    },
    donateModal: {
      title: 'Comprar créditos SaveTube',
      lead: 'Cada crédito desbloquea una descarga en alta resolución (1080p, 2K o 4K) en nuestro servidor. Elige un método de pago, envía el comprobante por WhatsApp y recibe tu voucher con los créditos.',
      quantity: 'Cantidad de créditos',
      total: 'Total',
      summary: '{{quantity}} crédito × {{symbol}} {{price}}',
      summary_plural: '{{quantity}} créditos × {{symbol}} {{price}}',
      empty: 'Aún no hay método de pago configurado.',
      paypalHint: 'Para recibir por PayPal sin usar donación, crea tu enlace en paypal.com/paypalme y regístralo aquí (ej: paypal.me/tunombre).',
      pix: {
        copyKey: 'Copiar clave',
        copyCode: 'Copiar código Pix'
      },
      crypto: {
        copyAddress: 'Copiar dirección'
      },
      paypalButton: 'Pagar {{symbol}} {{total}} con PayPal',
      genericButton: 'Pagar {{symbol}} {{total}} con {{name}}',
      whatsappHint: 'Después de pagar, haz clic en el botón de abajo y envía solo el comprobante. No es necesario explicar: solo la captura.',
      whatsappButton: 'Enviar comprobante por WhatsApp',
      poweredBy: 'Con tecnología de'
    },
    auth: {
      title: 'Entrar con e-mail',
      emailLabel: 'Tu e-mail',
      emailPlaceholder: 'tu@ejemplo.com',
      sendCode: 'Enviar código',
      codeLabel: 'Código de confirmación',
      codePlaceholder: '000000',
      confirm: 'Confirmar código',
      back: 'Volver',
      codeSent: '¡Código enviado! Revisa tu bandeja de entrada (y el spam).',
      devCode: 'Modo dev — código: {{code}}',
      invalidEmail: 'E-mail inválido',
      needLogin: 'Entra con tu e-mail para usar créditos.',
      genericError: 'Error de autenticación. Inténtalo de nuevo.',
      logout: 'Salir',
      loggedAs: 'Cuenta'
    },
    admin: {
      title: 'SaveTube Admin',
      passwordPlaceholder: 'Contraseña de administrador',
      login: 'Entrar',
      logout: 'Salir',
      wrongPassword: 'Contraseña incorrecta',
      loading: 'Cargando…',
      stats: {
        title: 'Estadísticas',
        created: 'Vouchers creados',
        redeemed: 'Vouchers canjeados',
        freeToday: 'Descargas gratis hoy'
      },
      generate: {
        title: 'Generar vouchers',
        amount: 'Cantidad',
        credits: 'Créditos por voucher',
        button: 'Generar',
        generated: 'Vouchers generados:',
        copyAll: 'Copiar todos'
      },
      vouchers: {
        title: 'Vouchers existentes',
        code: 'Código',
        credits: 'Créditos',
        status: 'Estado',
        date: 'Fecha',
        redeemed: 'Canjeado el {{date}}',
        active: 'Activo'
      },
      config: {
        title: 'Configuración de pagos',
        creditPrice: 'Precio del crédito ({{currency}})',
        whatsapp: 'WhatsApp (solo números)',
        methodsTitle: 'Métodos de pago',
        add: '+ Agregar método',
        save: 'Guardar configuración',
        namePlaceholder: 'Nombre',
        valuePlaceholder: 'URL / clave / usuario',
        active: 'Activo',
        remove: 'Eliminar',
        region: 'Región',
        exchangeRate: 'Tasa de cambio BRL → USD',
        defaultPricePreview: 'Precio global calculado',
        regions: {
          BR: 'Brasil (BRL)',
          default: 'Global (USD)',
          all: 'Todas las regiones'
        },
        types: {
          link: 'Link genérico',
          qrcode: 'QR Code (URL)',
          crypto: 'Criptomoneda'
        }
      },
      errors: {
        html: 'El servidor devolvió una página HTML en lugar de JSON. Verifica si el backend está corriendo.',
        unexpected: 'Respuesta inesperada',
        session: 'Sesión inválida',
        load: 'Error al cargar',
        login: 'Error al iniciar sesión',
        generate: 'Error al generar vouchers',
        save: 'Error al guardar configuración'
      },
      cookies: {
        title: 'Cookies de YouTube',
        description: 'Para descargar videos con restricción de edad, el sistema necesita cookies de una cuenta de YouTube con sesión iniciada. Configura YOUTUBE_EMAIL y YOUTUBE_PASSWORD en el archivo .env y haz clic en Actualizar cookies.',
        active: 'Cookies activas ({{size}} bytes)',
        inactive: 'Cookies inactivas ({{size}} bytes)',
        refresh: 'Actualizar cookies',
        error: 'Error al actualizar cookies',
        updating: 'Actualizando…'
      }
    }
  }
}

export type Translations = typeof translations.pt
