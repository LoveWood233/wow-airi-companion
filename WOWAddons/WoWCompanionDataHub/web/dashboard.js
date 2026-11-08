'use strict';

// Only numeric aggregates enter page state. Administrator keys are never retained.
const translations = {
  zhHans: {
    brand: '魔兽陪伴精灵 · 数据中台',
    language: '语言',
    console: '管理控制台',
    loginTitle: '每一份陪伴，都有迹可循。',
    loginIntro: '查看匿名安装登记与模型已报告的 Token 用量。',
    adminKey: '管理员密钥',
    signIn: '进入控制台',
    keyNote: '密钥仅用于建立本次会话，不保存在浏览器存储中。',
    overview: '运行概览',
    overviewIntro: '匿名汇总，了解陪伴精灵的使用趋势。',
    refresh: '刷新',
    exportCsv: '导出聚合 CSV',
    signOut: '退出',
    autoRefresh: '每 60 秒自动刷新',
    installs: '安装登记总数',
    installsHint: '首次运行登记 · 非真实人数',
    active5m: '最近 5 分钟活跃',
    reportedTotal: '已报告总 Token',
    lifetime: '服务器累计 · 仅已报告数字',
    inputTokens: '输入 Token',
    outputTokens: '输出 Token',
    unknownUsage: '用量未知的生成',
    unknownHint: '未返回可用 Token 数字的 SDK 生成',
    chartTitle: '已报告 Token 趋势',
    chartHint: '按服务器接收日（UTC）统计；所选天数仅影响此趋势图。',
    period: '趋势范围',
    days7: '7 天',
    days30: '30 天',
    days90: '90 天',
    noTokens: '所选时段尚无已报告的总 Token；输入与输出可能单独有报告。',
    chartFooter: '总量字段由服务商独立提供，可能不等于已知输入量与输出量之和。',
    coverageTitle: '累计用量报告覆盖',
    coverageHint: '覆盖率表示 SDK 生成有返回字段，不能证明全部内部工具轮次都已计入。',
    versionsTitle: '客户端版本分布',
    versionsHint: '按每个安装登记最后上报的客户端版本汇总。',
    version: '版本',
    registrations: '登记数',
    share: '占比',
    noVersions: '尚无安装登记。',
    readingTitle: '如何解读这些数据',
    readingInstalls: '安装数是首次运行登记数，不等同真实用户数；重装或更换配置目录可能产生新登记。',
    readingTrust: '数据由客户端自报，可能被伪造。仅用于趋势观察，不是计费账单或审计凭据。',
    readingMissing: '仅累计服务商实际返回的 Token 数字；缺失字段保持未知，不估算、不补零。未返回 Token 的 TTS/ASR 不纳入。',
    readingRequests: '一次用量记录代表一次 SDK 生成，可能包含多个 HTTP 工具轮次；有用量报告不代表每一轮都完整。',
    privacy: '仅展示聚合数据，不展示安装标识、IP、角色、对话或密钥。',
    connecting: '正在连接…',
    connected: '已连接 · 聚合数据已更新',
    signInNeeded: '请输入管理员密钥以查看数据。',
    sessionExpired: '会话已失效，请重新登录。',
    signingIn: '正在登录…',
    loadFailed: '请求失败，请稍后重试。',
    rateLimited: '请求过于频繁，请稍后重试。',
    invalidData: '统计数据格式无效。',
    updating: '正在刷新…',
    updatedAt: '更新于 {time}（本地时间）',
    active24h: '最近 24 小时活跃：{count}',
    requests: 'SDK 生成记录数',
    anyUsage: '含任一用量字段',
    inputCoverage: '输入字段有报告',
    outputCoverage: '输出字段有报告',
    totalCoverage: '总量字段有报告',
    chartDay: '日期（UTC）',
    signedOut: '已退出，本页数据已清除。',
    logoutFailed: '退出请求失败，请刷新后重试。',
    category: '分类',
    metric: '指标',
    value: '数值',
    periodDays: '趋势天数',
    snapshotAt: '快照时间（UTC）',
    overall: '累计汇总',
    stale: '请求失败，当前显示上次成功结果。',
    noScript: '请启用 JavaScript 以查看控制台。'
  },
  zhHant: {
    brand: '魔獸陪伴精靈 · 資料中台',
    language: '語言',
    console: '管理控制台',
    loginTitle: '每一份陪伴，都有跡可循。',
    loginIntro: '查看匿名安裝登記與模型已回報的 Token 用量。',
    adminKey: '管理員金鑰',
    signIn: '進入控制台',
    keyNote: '金鑰僅用於建立本次工作階段，不儲存在瀏覽器儲存空間中。',
    overview: '運作概覽',
    overviewIntro: '匿名彙總，了解陪伴精靈的使用趨勢。',
    refresh: '重新整理',
    exportCsv: '匯出彙總 CSV',
    signOut: '登出',
    autoRefresh: '每 60 秒自動更新',
    installs: '安裝登記總數',
    installsHint: '首次執行登記 · 非實際人數',
    active5m: '最近 5 分鐘活躍',
    reportedTotal: '已回報總 Token',
    lifetime: '伺服器累計 · 僅已回報數字',
    inputTokens: '輸入 Token',
    outputTokens: '輸出 Token',
    unknownUsage: '用量未知的生成',
    unknownHint: '未傳回有效 Token 數字的 SDK 生成',
    chartTitle: '已回報 Token 趨勢',
    chartHint: '按伺服器接收日（UTC）統計；所選天數僅影響此趨勢圖。',
    period: '趨勢範圍',
    days7: '7 天',
    days30: '30 天',
    days90: '90 天',
    noTokens: '所選時段尚無已回報的總 Token；輸入與輸出可能另有回報。',
    chartFooter: '總量欄位由服務商獨立提供，可能不等於已知輸入量與輸出量之和。',
    coverageTitle: '累計用量回報涵蓋率',
    coverageHint: '涵蓋率表示 SDK 生成有傳回欄位，無法證明所有內部工具回合均已計入。',
    versionsTitle: '用戶端版本分布',
    versionsHint: '按每筆安裝登記最後回報的用戶端版本彙總。',
    version: '版本',
    registrations: '登記數',
    share: '占比',
    noVersions: '尚無安裝登記。',
    readingTitle: '如何解讀這些資料',
    readingInstalls: '安裝數是首次執行登記數，不等同實際使用者數；重新安裝或更換設定目錄可能產生新登記。',
    readingTrust: '資料由用戶端自行回報，可能遭偽造。僅供觀察趨勢，並非計費帳單或稽核憑證。',
    readingMissing: '僅累計服務商實際傳回的 Token 數字；缺失欄位維持未知，不估算、不補零。未傳回 Token 的 TTS/ASR 不納入。',
    readingRequests: '一次用量記錄代表一次 SDK 生成，可能包含多個 HTTP 工具回合；有回報不代表每一回合都完整。',
    privacy: '僅顯示彙總資料，不顯示安裝識別碼、IP、角色、對話或金鑰。',
    connecting: '正在連線…',
    connected: '已連線 · 彙總資料已更新',
    signInNeeded: '請輸入管理員金鑰以查看資料。',
    sessionExpired: '工作階段已失效，請重新登入。',
    signingIn: '正在登入…',
    loadFailed: '請求失敗，請稍後再試。',
    rateLimited: '請求過於頻繁，請稍後再試。',
    invalidData: '統計資料格式無效。',
    updating: '正在更新…',
    updatedAt: '更新於 {time}（當地時間）',
    active24h: '最近 24 小時活躍：{count}',
    requests: 'SDK 生成記錄數',
    anyUsage: '含任一用量欄位',
    inputCoverage: '輸入欄位有回報',
    outputCoverage: '輸出欄位有回報',
    totalCoverage: '總量欄位有回報',
    chartDay: '日期（UTC）',
    signedOut: '已登出，本頁資料已清除。',
    logoutFailed: '登出請求失敗，請重新整理後再試。',
    category: '分類',
    metric: '指標',
    value: '數值',
    periodDays: '趨勢天數',
    snapshotAt: '快照時間（UTC）',
    overall: '累計彙總',
    stale: '請求失敗，目前顯示上次成功結果。',
    noScript: '請啟用 JavaScript 以查看控制台。'
  },
  en: {
    brand: 'WoW Companion · Data Hub',
    language: 'Language',
    console: 'Administration',
    loginTitle: 'A clearer view of every journey together.',
    loginIntro: 'View anonymous installation registrations and model-reported token usage.',
    adminKey: 'Administrator key',
    signIn: 'Open dashboard',
    keyNote: 'The key only establishes this session and is never kept in browser storage.',
    overview: 'Overview',
    overviewIntro: 'Anonymous aggregates for understanding companion usage trends.',
    refresh: 'Refresh',
    exportCsv: 'Export aggregate CSV',
    signOut: 'Sign out',
    autoRefresh: 'Refreshes every 60 seconds',
    installs: 'Registered installations',
    installsHint: 'First-run registrations · not unique people',
    active5m: 'Active in the last 5 minutes',
    reportedTotal: 'Reported total tokens',
    lifetime: 'Server lifetime · reported counts only',
    inputTokens: 'Input tokens',
    outputTokens: 'Output tokens',
    unknownUsage: 'Generations with unknown usage',
    unknownHint: 'SDK generations with no usable token counts',
    chartTitle: 'Reported token trend',
    chartHint: 'Grouped by server receipt day (UTC). The selected range applies only to this chart.',
    period: 'Trend range',
    days7: '7 days',
    days30: '30 days',
    days90: '90 days',
    noTokens: 'No reported total tokens in this period. Input or output counts may still be reported separately.',
    chartFooter: 'Providers report total tokens independently; totals may differ from the sum of known input and output counts.',
    coverageTitle: 'Lifetime usage reporting coverage',
    coverageHint: 'Coverage means an SDK generation returned a field, not that all internal tool rounds were counted.',
    versionsTitle: 'Client versions',
    versionsHint: 'Grouped by the last client version reported for each registered installation.',
    version: 'Version',
    registrations: 'Registrations',
    share: 'Share',
    noVersions: 'No registered installations yet.',
    readingTitle: 'Understanding these numbers',
    readingInstalls: 'Installation counts are first-run registrations, not unique users. Reinstallation or a new profile directory can create another registration.',
    readingTrust: 'Clients report these numbers themselves and can falsify them. Use them for trends, not billing or auditing.',
    readingMissing: 'Only provider-reported token counts are added. Missing fields remain unknown; they are neither estimated nor replaced with zero. TTS/ASR without token usage are excluded.',
    readingRequests: 'A usage record represents one SDK generation, which may contain multiple HTTP tool rounds. A usage report does not guarantee complete reporting for every round.',
    privacy: 'Aggregates only. No installation identifiers, IP addresses, characters, conversations or keys are shown.',
    connecting: 'Connecting…',
    connected: 'Connected · aggregates updated',
    signInNeeded: 'Enter your administrator key to view the data.',
    sessionExpired: 'Session expired. Please sign in again.',
    signingIn: 'Signing in…',
    loadFailed: 'Request failed. Please try again later.',
    rateLimited: 'Too many requests. Please try again later.',
    invalidData: 'The statistics format is invalid.',
    updating: 'Refreshing…',
    updatedAt: 'Updated {time} (local time)',
    active24h: 'Active in the last 24 hours: {count}',
    requests: 'SDK generation records',
    anyUsage: 'Any usage field reported',
    inputCoverage: 'Input field reported',
    outputCoverage: 'Output field reported',
    totalCoverage: 'Total field reported',
    chartDay: 'Date (UTC)',
    signedOut: 'Signed out. Page data cleared.',
    logoutFailed: 'Sign-out failed. Refresh and try again.',
    category: 'Category',
    metric: 'Metric',
    value: 'Value',
    periodDays: 'Trend days',
    snapshotAt: 'Snapshot time (UTC)',
    overall: 'Lifetime totals',
    stale: 'Request failed. Showing the last successful snapshot.',
    noScript: 'Enable JavaScript to view the dashboard.'
  },
  es: {
    brand: 'Compañero de WoW · Centro de datos',
    language: 'Idioma',
    console: 'Administración',
    loginTitle: 'Una mirada a cada aventura compartida.',
    loginIntro: 'Consulta registros de instalación anónimos y los tokens informados por los modelos.',
    adminKey: 'Clave de administrador',
    signIn: 'Abrir panel',
    keyNote: 'La clave solo inicia esta sesión y no se conserva en el almacenamiento del navegador.',
    overview: 'Resumen',
    overviewIntro: 'Datos anónimos agregados para conocer las tendencias de uso.',
    refresh: 'Actualizar',
    exportCsv: 'Exportar CSV agregado',
    signOut: 'Cerrar sesión',
    autoRefresh: 'Se actualiza cada 60 segundos',
    installs: 'Instalaciones registradas',
    installsHint: 'Registros del primer inicio · no personas únicas',
    active5m: 'Activas en los últimos 5 minutos',
    reportedTotal: 'Tokens totales informados',
    lifetime: 'Acumulado del servidor · solo cifras informadas',
    inputTokens: 'Tokens de entrada',
    outputTokens: 'Tokens de salida',
    unknownUsage: 'Generaciones con uso desconocido',
    unknownHint: 'Generaciones del SDK sin recuentos de tokens válidos',
    chartTitle: 'Tendencia de tokens informados',
    chartHint: 'Agrupados por día de recepción del servidor (UTC). El intervalo solo afecta a este gráfico.',
    period: 'Intervalo de tendencia',
    days7: '7 días',
    days30: '30 días',
    days90: '90 días',
    noTokens: 'No hay tokens totales informados en este intervalo. Puede haber entradas o salidas informadas por separado.',
    chartFooter: 'El proveedor informa el total de forma independiente; puede diferir de la suma conocida de entrada y salida.',
    coverageTitle: 'Cobertura acumulada de informes',
    coverageHint: 'La cobertura indica que una generación del SDK devolvió un campo, no que se contaran todas sus rondas de herramientas.',
    versionsTitle: 'Versiones del cliente',
    versionsHint: 'Agrupadas por la última versión informada de cada instalación registrada.',
    version: 'Versión',
    registrations: 'Registros',
    share: 'Proporción',
    noVersions: 'Todavía no hay instalaciones registradas.',
    readingTitle: 'Cómo interpretar estas cifras',
    readingInstalls: 'Las instalaciones son registros del primer inicio, no usuarios únicos. Reinstalar o cambiar el directorio del perfil puede crear otro registro.',
    readingTrust: 'Los clientes informan estos datos y pueden falsificarlos. Sirven para observar tendencias, no para facturar ni auditar.',
    readingMissing: 'Solo se suman los tokens devueltos por el proveedor. Los campos ausentes siguen siendo desconocidos, sin estimaciones ni ceros. TTS/ASR sin tokens quedan excluidos.',
    readingRequests: 'Un registro representa una generación del SDK, que puede incluir varias rondas HTTP de herramientas. Tener un informe no garantiza que todas las rondas estén completas.',
    privacy: 'Solo datos agregados. No se muestran identificadores, direcciones IP, personajes, conversaciones ni claves.',
    connecting: 'Conectando…',
    connected: 'Conectado · datos agregados actualizados',
    signInNeeded: 'Introduce tu clave de administrador para ver los datos.',
    sessionExpired: 'La sesión ha caducado. Vuelve a iniciar sesión.',
    signingIn: 'Iniciando sesión…',
    loadFailed: 'La solicitud ha fallado. Inténtalo más tarde.',
    rateLimited: 'Demasiadas solicitudes. Inténtalo más tarde.',
    invalidData: 'El formato de las estadísticas no es válido.',
    updating: 'Actualizando…',
    updatedAt: 'Actualizado: {time} (hora local)',
    active24h: 'Activas en las últimas 24 horas: {count}',
    requests: 'Registros de generación del SDK',
    anyUsage: 'Algún campo de uso informado',
    inputCoverage: 'Campo de entrada informado',
    outputCoverage: 'Campo de salida informado',
    totalCoverage: 'Campo total informado',
    chartDay: 'Fecha (UTC)',
    signedOut: 'Sesión cerrada. Se han borrado los datos de esta página.',
    logoutFailed: 'No se pudo cerrar la sesión. Actualiza e inténtalo de nuevo.',
    category: 'Categoría',
    metric: 'Métrica',
    value: 'Valor',
    periodDays: 'Días de tendencia',
    snapshotAt: 'Hora de la instantánea (UTC)',
    overall: 'Totales acumulados',
    stale: 'La solicitud ha fallado. Se muestra la última instantánea válida.',
    noScript: 'Activa JavaScript para ver el panel.'
  },
  fr: {
    brand: 'Compagnon WoW · Centre de données',
    language: 'Langue',
    console: 'Administration',
    loginTitle: 'Un regard sur chaque aventure partagée.',
    loginIntro: 'Consultez les inscriptions anonymes et les jetons déclarés par les modèles.',
    adminKey: 'Clé administrateur',
    signIn: 'Ouvrir le tableau de bord',
    keyNote: 'La clé ouvre uniquement cette session et n’est jamais conservée dans le stockage du navigateur.',
    overview: 'Vue d’ensemble',
    overviewIntro: 'Des données anonymes agrégées pour suivre les tendances d’utilisation.',
    refresh: 'Actualiser',
    exportCsv: 'Exporter les agrégats CSV',
    signOut: 'Se déconnecter',
    autoRefresh: 'Actualisation toutes les 60 secondes',
    installs: 'Installations enregistrées',
    installsHint: 'Inscriptions au premier lancement · pas des personnes uniques',
    active5m: 'Actives depuis 5 minutes',
    reportedTotal: 'Total des jetons déclarés',
    lifetime: 'Cumul du serveur · chiffres déclarés uniquement',
    inputTokens: 'Jetons d’entrée',
    outputTokens: 'Jetons de sortie',
    unknownUsage: 'Générations à usage inconnu',
    unknownHint: 'Générations du SDK sans nombre de jetons exploitable',
    chartTitle: 'Évolution des jetons déclarés',
    chartHint: 'Par jour de réception du serveur (UTC). La période choisie ne concerne que ce graphique.',
    period: 'Période du graphique',
    days7: '7 jours',
    days30: '30 jours',
    days90: '90 jours',
    noTokens: 'Aucun total de jetons déclaré sur cette période. Les entrées ou sorties peuvent être déclarées séparément.',
    chartFooter: 'Les fournisseurs déclarent le total indépendamment ; il peut différer de la somme connue des entrées et sorties.',
    coverageTitle: 'Couverture cumulée des déclarations',
    coverageHint: 'La couverture indique qu’une génération du SDK a renvoyé un champ, sans garantir la prise en compte de tous ses tours d’outils.',
    versionsTitle: 'Versions du client',
    versionsHint: 'Regroupées selon la dernière version déclarée par chaque installation enregistrée.',
    version: 'Version',
    registrations: 'Inscriptions',
    share: 'Part',
    noVersions: 'Aucune installation enregistrée.',
    readingTitle: 'Comprendre ces chiffres',
    readingInstalls: 'Le nombre d’installations correspond aux inscriptions au premier lancement, pas aux utilisateurs uniques. Une réinstallation ou un autre dossier de profil peut créer une nouvelle inscription.',
    readingTrust: 'Les clients déclarent eux-mêmes ces chiffres et peuvent les falsifier. Utilisez-les pour observer les tendances, pas pour la facturation ou l’audit.',
    readingMissing: 'Seuls les jetons renvoyés par le fournisseur sont additionnés. Les champs absents restent inconnus, sans estimation ni zéro ajouté. Les TTS/ASR sans jetons sont exclus.',
    readingRequests: 'Un enregistrement correspond à une génération du SDK, qui peut inclure plusieurs tours HTTP d’outils. Une déclaration ne garantit pas que chaque tour soit complet.',
    privacy: 'Données agrégées uniquement. Aucun identifiant, IP, personnage, échange ou clé n’est affiché.',
    connecting: 'Connexion…',
    connected: 'Connecté · agrégats actualisés',
    signInNeeded: 'Saisissez votre clé administrateur pour consulter les données.',
    sessionExpired: 'Session expirée. Veuillez vous reconnecter.',
    signingIn: 'Connexion en cours…',
    loadFailed: 'Échec de la requête. Réessayez plus tard.',
    rateLimited: 'Trop de requêtes. Réessayez plus tard.',
    invalidData: 'Le format des statistiques est invalide.',
    updating: 'Actualisation…',
    updatedAt: 'Actualisé le {time} (heure locale)',
    active24h: 'Actives depuis 24 heures : {count}',
    requests: 'Générations du SDK enregistrées',
    anyUsage: 'Au moins un champ déclaré',
    inputCoverage: 'Champ d’entrée déclaré',
    outputCoverage: 'Champ de sortie déclaré',
    totalCoverage: 'Champ total déclaré',
    chartDay: 'Date (UTC)',
    signedOut: 'Déconnecté. Données de la page effacées.',
    logoutFailed: 'Échec de la déconnexion. Actualisez et réessayez.',
    category: 'Catégorie',
    metric: 'Indicateur',
    value: 'Valeur',
    periodDays: 'Jours du graphique',
    snapshotAt: 'Heure de l’instantané (UTC)',
    overall: 'Totaux cumulés',
    stale: 'Échec de la requête. Dernier instantané valide affiché.',
    noScript: 'Activez JavaScript pour afficher le tableau de bord.'
  },
  it: {
    brand: 'Compagno WoW · Centro dati',
    language: 'Lingua',
    console: 'Amministrazione',
    loginTitle: 'Uno sguardo a ogni avventura insieme.',
    loginIntro: 'Consulta le registrazioni anonime e i token comunicati dai modelli.',
    adminKey: 'Chiave amministratore',
    signIn: 'Apri il pannello',
    keyNote: 'La chiave avvia solo questa sessione e non viene conservata nella memoria del browser.',
    overview: 'Panoramica',
    overviewIntro: 'Dati anonimi aggregati per comprendere le tendenze di utilizzo.',
    refresh: 'Aggiorna',
    exportCsv: 'Esporta CSV aggregato',
    signOut: 'Esci',
    autoRefresh: 'Aggiornamento ogni 60 secondi',
    installs: 'Installazioni registrate',
    installsHint: 'Registrazioni al primo avvio · non persone uniche',
    active5m: 'Attive negli ultimi 5 minuti',
    reportedTotal: 'Token totali comunicati',
    lifetime: 'Cumulativo del server · solo cifre comunicate',
    inputTokens: 'Token in ingresso',
    outputTokens: 'Token in uscita',
    unknownUsage: 'Generazioni con utilizzo sconosciuto',
    unknownHint: 'Generazioni SDK senza conteggi di token validi',
    chartTitle: 'Andamento dei token comunicati',
    chartHint: 'Per giorno di ricezione del server (UTC). Il periodo scelto si applica solo a questo grafico.',
    period: 'Periodo del grafico',
    days7: '7 giorni',
    days30: '30 giorni',
    days90: '90 giorni',
    noTokens: 'Nessun totale di token comunicato nel periodo. Ingressi o uscite possono essere comunicati separatamente.',
    chartFooter: 'Il fornitore comunica il totale separatamente; può differire dalla somma nota di ingressi e uscite.',
    coverageTitle: 'Copertura cumulativa delle comunicazioni',
    coverageHint: 'La copertura indica che una generazione SDK ha restituito un campo, non che siano stati conteggiati tutti i turni degli strumenti.',
    versionsTitle: 'Versioni del client',
    versionsHint: 'Raggruppate per l’ultima versione comunicata da ogni installazione registrata.',
    version: 'Versione',
    registrations: 'Registrazioni',
    share: 'Quota',
    noVersions: 'Nessuna installazione registrata.',
    readingTitle: 'Come interpretare questi dati',
    readingInstalls: 'Le installazioni sono registrazioni al primo avvio, non utenti unici. Una reinstallazione o una nuova cartella del profilo può creare un’altra registrazione.',
    readingTrust: 'I dati sono dichiarati dai client e possono essere falsificati. Servono a osservare le tendenze, non a fatturare o effettuare verifiche contabili.',
    readingMissing: 'Si sommano solo i token restituiti dal fornitore. I campi assenti restano sconosciuti, senza stime né zeri aggiunti. TTS/ASR senza token sono esclusi.',
    readingRequests: 'Un record rappresenta una generazione SDK, che può comprendere più turni HTTP degli strumenti. Una comunicazione non garantisce che ogni turno sia completo.',
    privacy: 'Solo dati aggregati. Non vengono mostrati identificativi, IP, personaggi, conversazioni o chiavi.',
    connecting: 'Connessione…',
    connected: 'Connesso · dati aggregati aggiornati',
    signInNeeded: 'Inserisci la chiave amministratore per visualizzare i dati.',
    sessionExpired: 'Sessione scaduta. Accedi nuovamente.',
    signingIn: 'Accesso in corso…',
    loadFailed: 'Richiesta non riuscita. Riprova più tardi.',
    rateLimited: 'Troppe richieste. Riprova più tardi.',
    invalidData: 'Formato delle statistiche non valido.',
    updating: 'Aggiornamento…',
    updatedAt: 'Aggiornato: {time} (ora locale)',
    active24h: 'Attive nelle ultime 24 ore: {count}',
    requests: 'Record di generazione SDK',
    anyUsage: 'Almeno un campo comunicato',
    inputCoverage: 'Campo di ingresso comunicato',
    outputCoverage: 'Campo di uscita comunicato',
    totalCoverage: 'Campo totale comunicato',
    chartDay: 'Data (UTC)',
    signedOut: 'Disconnesso. Dati della pagina cancellati.',
    logoutFailed: 'Uscita non riuscita. Aggiorna e riprova.',
    category: 'Categoria',
    metric: 'Indicatore',
    value: 'Valore',
    periodDays: 'Giorni del grafico',
    snapshotAt: 'Ora dell’istantanea (UTC)',
    overall: 'Totali cumulativi',
    stale: 'Richiesta non riuscita. È mostrata l’ultima istantanea valida.',
    noScript: 'Abilita JavaScript per visualizzare il pannello.'
  },
  pt: {
    brand: 'Companheiro WoW · Central de dados',
    language: 'Idioma',
    console: 'Administração',
    loginTitle: 'Um olhar sobre cada aventura juntos.',
    loginIntro: 'Consulte registros anônimos de instalação e tokens informados pelos modelos.',
    adminKey: 'Chave de administrador',
    signIn: 'Abrir painel',
    keyNote: 'A chave apenas inicia esta sessão e não é guardada no armazenamento do navegador.',
    overview: 'Visão geral',
    overviewIntro: 'Dados anônimos agregados para entender as tendências de uso.',
    refresh: 'Atualizar',
    exportCsv: 'Exportar CSV agregado',
    signOut: 'Sair',
    autoRefresh: 'Atualização a cada 60 segundos',
    installs: 'Instalações registradas',
    installsHint: 'Registros no primeiro uso · não pessoas únicas',
    active5m: 'Ativas nos últimos 5 minutos',
    reportedTotal: 'Total de tokens informados',
    lifetime: 'Acumulado do servidor · apenas valores informados',
    inputTokens: 'Tokens de entrada',
    outputTokens: 'Tokens de saída',
    unknownUsage: 'Gerações com uso desconhecido',
    unknownHint: 'Gerações do SDK sem contagens de tokens válidas',
    chartTitle: 'Tendência dos tokens informados',
    chartHint: 'Por dia de recebimento no servidor (UTC). O período escolhido afeta apenas este gráfico.',
    period: 'Período do gráfico',
    days7: '7 dias',
    days30: '30 dias',
    days90: '90 dias',
    noTokens: 'Nenhum total de tokens informado no período. Entradas ou saídas podem ter sido informadas separadamente.',
    chartFooter: 'O provedor informa o total de forma independente; ele pode diferir da soma conhecida de entrada e saída.',
    coverageTitle: 'Cobertura acumulada dos informes',
    coverageHint: 'A cobertura indica que uma geração do SDK retornou um campo, não que todas as rodadas de ferramentas foram contadas.',
    versionsTitle: 'Versões do cliente',
    versionsHint: 'Agrupadas pela última versão informada de cada instalação registrada.',
    version: 'Versão',
    registrations: 'Registros',
    share: 'Proporção',
    noVersions: 'Nenhuma instalação registrada.',
    readingTitle: 'Como interpretar estes números',
    readingInstalls: 'As instalações são registros no primeiro uso, não usuários únicos. Reinstalar ou mudar a pasta do perfil pode criar outro registro.',
    readingTrust: 'Os próprios clientes informam os dados e podem falsificá-los. Use para observar tendências, não para cobrança ou auditoria.',
    readingMissing: 'Somam-se apenas os tokens retornados pelo provedor. Campos ausentes permanecem desconhecidos, sem estimativas nem zeros adicionados. TTS/ASR sem tokens ficam excluídos.',
    readingRequests: 'Um registro representa uma geração do SDK, que pode incluir várias rodadas HTTP de ferramentas. Um informe não garante que cada rodada esteja completa.',
    privacy: 'Apenas dados agregados. Não são exibidos identificadores, IPs, personagens, conversas ou chaves.',
    connecting: 'Conectando…',
    connected: 'Conectado · dados agregados atualizados',
    signInNeeded: 'Insira sua chave de administrador para ver os dados.',
    sessionExpired: 'Sessão expirada. Entre novamente.',
    signingIn: 'Entrando…',
    loadFailed: 'A solicitação falhou. Tente mais tarde.',
    rateLimited: 'Muitas solicitações. Tente mais tarde.',
    invalidData: 'O formato das estatísticas é inválido.',
    updating: 'Atualizando…',
    updatedAt: 'Atualizado em {time} (hora local)',
    active24h: 'Ativas nas últimas 24 horas: {count}',
    requests: 'Registros de geração do SDK',
    anyUsage: 'Algum campo de uso informado',
    inputCoverage: 'Campo de entrada informado',
    outputCoverage: 'Campo de saída informado',
    totalCoverage: 'Campo total informado',
    chartDay: 'Data (UTC)',
    signedOut: 'Sessão encerrada. Dados da página apagados.',
    logoutFailed: 'Não foi possível sair. Atualize e tente novamente.',
    category: 'Categoria',
    metric: 'Métrica',
    value: 'Valor',
    periodDays: 'Dias do gráfico',
    snapshotAt: 'Hora do retrato (UTC)',
    overall: 'Totais acumulados',
    stale: 'A solicitação falhou. Mostrando o último retrato válido.',
    noScript: 'Ative o JavaScript para ver o painel.'
  },
  ja: {
    brand: 'WoW コンパニオン · データハブ',
    language: '言語',
    console: '管理コンソール',
    loginTitle: '共に歩んだ冒険を、数字で見つめる。',
    loginIntro: '匿名のインストール登録と、モデルが報告したトークン使用量を確認します。',
    adminKey: '管理者キー',
    signIn: 'ダッシュボードを開く',
    keyNote: 'キーはこのセッションの開始にのみ使用し、ブラウザーのストレージには保存しません。',
    overview: '稼働状況',
    overviewIntro: '匿名の集計からコンパニオンの利用傾向を把握できます。',
    refresh: '更新',
    exportCsv: '集計 CSV を出力',
    signOut: 'ログアウト',
    autoRefresh: '60 秒ごとに自動更新',
    installs: 'インストール登録総数',
    installsHint: '初回起動時の登録 · 実人数ではありません',
    active5m: '直近 5 分のアクティブ数',
    reportedTotal: '報告済み総トークン',
    lifetime: 'サーバー累計 · 報告値のみ',
    inputTokens: '入力トークン',
    outputTokens: '出力トークン',
    unknownUsage: '使用量不明の生成',
    unknownHint: '有効なトークン数が返されなかった SDK 生成',
    chartTitle: '報告済みトークンの推移',
    chartHint: 'サーバー受信日（UTC）で集計。期間の選択はこのグラフにのみ適用されます。',
    period: 'グラフの期間',
    days7: '7 日',
    days30: '30 日',
    days90: '90 日',
    noTokens: 'この期間には総トークン数の報告がありません。入力・出力が個別に報告されている場合があります。',
    chartFooter: '総量はサービス提供元が独立して報告するため、既知の入力と出力の合計と異なる場合があります。',
    coverageTitle: '累計使用量の報告範囲',
    coverageHint: '報告率は SDK 生成から項目が返された割合であり、内部の全ツールラウンドが集計済みとは限りません。',
    versionsTitle: 'クライアントのバージョン分布',
    versionsHint: '登録済みインストールごとの最終報告バージョンで集計しています。',
    version: 'バージョン',
    registrations: '登録数',
    share: '割合',
    noVersions: 'インストール登録はまだありません。',
    readingTitle: '数値の見方',
    readingInstalls: 'インストール数は初回起動時の登録数であり、利用者の実人数ではありません。再インストールや設定フォルダーの変更で新たに登録される場合があります。',
    readingTrust: 'データはクライアントの自己申告で、偽装される可能性があります。傾向の把握にのみ使用し、請求や監査の根拠にはしないでください。',
    readingMissing: 'サービス提供元が返したトークン数のみ加算します。欠落項目は不明のままとし、推定やゼロ補完は行いません。トークン数のない TTS/ASR は含めません。',
    readingRequests: '1 件の使用量記録は SDK の 1 回の生成を表し、複数の HTTP ツールラウンドを含む場合があります。報告があっても全ラウンドが完全とは限りません。',
    privacy: '集計値のみを表示します。インストール識別子、IP、キャラクター、会話、キーは表示しません。',
    connecting: '接続中…',
    connected: '接続済み · 集計を更新しました',
    signInNeeded: '管理者キーを入力するとデータを確認できます。',
    sessionExpired: 'セッションが切れました。再度ログインしてください。',
    signingIn: 'ログイン中…',
    loadFailed: 'リクエストに失敗しました。後でもう一度お試しください。',
    rateLimited: 'リクエストが多すぎます。後でもう一度お試しください。',
    invalidData: '統計データの形式が無効です。',
    updating: '更新中…',
    updatedAt: '更新：{time}（現地時間）',
    active24h: '直近 24 時間のアクティブ数：{count}',
    requests: 'SDK 生成の記録数',
    anyUsage: 'いずれかの使用量項目あり',
    inputCoverage: '入力項目の報告あり',
    outputCoverage: '出力項目の報告あり',
    totalCoverage: '総量項目の報告あり',
    chartDay: '日付（UTC）',
    signedOut: 'ログアウトしました。画面のデータを消去しました。',
    logoutFailed: 'ログアウトに失敗しました。更新して再試行してください。',
    category: '分類',
    metric: '指標',
    value: '値',
    periodDays: 'グラフの日数',
    snapshotAt: '集計時刻（UTC）',
    overall: '累計',
    stale: 'リクエストに失敗しました。直前の正常な集計を表示しています。',
    noScript: 'ダッシュボードを表示するには JavaScript を有効にしてください。'
  },
  ko: {
    brand: 'WoW 동반 정령 · 데이터 허브',
    language: '언어',
    console: '관리 콘솔',
    loginTitle: '함께한 모험의 발자취를 살펴보세요.',
    loginIntro: '익명 설치 등록과 모델이 보고한 토큰 사용량을 확인합니다.',
    adminKey: '관리자 키',
    signIn: '대시보드 열기',
    keyNote: '키는 이번 세션을 시작할 때만 사용하며 브라우저 저장소에 보관하지 않습니다.',
    overview: '운영 개요',
    overviewIntro: '익명 집계로 동반 정령의 사용 추세를 파악합니다.',
    refresh: '새로 고침',
    exportCsv: '집계 CSV 내보내기',
    signOut: '로그아웃',
    autoRefresh: '60초마다 자동 새로 고침',
    installs: '설치 등록 총수',
    installsHint: '최초 실행 등록 · 실제 인원수 아님',
    active5m: '최근 5분간 활성 설치',
    reportedTotal: '보고된 총 토큰',
    lifetime: '서버 누적 · 보고된 수치만',
    inputTokens: '입력 토큰',
    outputTokens: '출력 토큰',
    unknownUsage: '사용량 미상의 생성',
    unknownHint: '유효한 토큰 수가 반환되지 않은 SDK 생성',
    chartTitle: '보고된 토큰 추세',
    chartHint: '서버 수신일(UTC) 기준입니다. 선택한 기간은 이 그래프에만 적용됩니다.',
    period: '추세 기간',
    days7: '7일',
    days30: '30일',
    days90: '90일',
    noTokens: '선택한 기간에 보고된 총 토큰이 없습니다. 입력 또는 출력은 별도로 보고되었을 수 있습니다.',
    chartFooter: '총량은 제공업체가 독립적으로 보고하므로 알려진 입력과 출력의 합과 다를 수 있습니다.',
    coverageTitle: '누적 사용량 보고 범위',
    coverageHint: '보고율은 SDK 생성에 해당 필드가 있었다는 뜻이며 모든 내부 도구 라운드가 집계되었음을 보장하지 않습니다.',
    versionsTitle: '클라이언트 버전 분포',
    versionsHint: '등록된 각 설치에서 마지막으로 보고한 클라이언트 버전별 집계입니다.',
    version: '버전',
    registrations: '등록 수',
    share: '비율',
    noVersions: '등록된 설치가 없습니다.',
    readingTitle: '수치 해석 안내',
    readingInstalls: '설치 수는 최초 실행 등록 수이며 실제 사용자 수가 아닙니다. 재설치나 프로필 폴더 변경 시 새 등록이 생길 수 있습니다.',
    readingTrust: '클라이언트가 직접 보고하는 데이터로 위조될 수 있습니다. 추세 파악용이며 과금 청구서나 감사 근거가 아닙니다.',
    readingMissing: '제공업체가 반환한 토큰 수만 합산합니다. 누락 필드는 미상으로 유지하며 추정하거나 0으로 대체하지 않습니다. 토큰을 반환하지 않는 TTS/ASR은 제외됩니다.',
    readingRequests: '사용량 기록 하나는 SDK 생성 한 번이며 여러 HTTP 도구 라운드를 포함할 수 있습니다. 보고가 있어도 모든 라운드가 완전하다는 뜻은 아닙니다.',
    privacy: '집계만 표시하며 설치 식별자, IP, 캐릭터, 대화 또는 키는 표시하지 않습니다.',
    connecting: '연결 중…',
    connected: '연결됨 · 집계 업데이트 완료',
    signInNeeded: '데이터를 보려면 관리자 키를 입력하세요.',
    sessionExpired: '세션이 만료되었습니다. 다시 로그인하세요.',
    signingIn: '로그인 중…',
    loadFailed: '요청에 실패했습니다. 나중에 다시 시도하세요.',
    rateLimited: '요청이 너무 많습니다. 나중에 다시 시도하세요.',
    invalidData: '통계 데이터 형식이 올바르지 않습니다.',
    updating: '새로 고치는 중…',
    updatedAt: '업데이트: {time} (현지 시간)',
    active24h: '최근 24시간 활성 설치: {count}',
    requests: 'SDK 생성 기록 수',
    anyUsage: '사용량 필드 하나 이상 보고',
    inputCoverage: '입력 필드 보고',
    outputCoverage: '출력 필드 보고',
    totalCoverage: '총량 필드 보고',
    chartDay: '날짜(UTC)',
    signedOut: '로그아웃했습니다. 페이지 데이터를 지웠습니다.',
    logoutFailed: '로그아웃에 실패했습니다. 새로 고침 후 다시 시도하세요.',
    category: '분류',
    metric: '지표',
    value: '값',
    periodDays: '추세 일수',
    snapshotAt: '스냅샷 시각(UTC)',
    overall: '누적 합계',
    stale: '요청에 실패했습니다. 마지막으로 성공한 스냅샷을 표시합니다.',
    noScript: '대시보드를 보려면 JavaScript를 켜세요.'
  },
  ru: {
    brand: 'Спутник WoW · Центр данных',
    language: 'Язык',
    console: 'Администрирование',
    loginTitle: 'Взгляд на каждое совместное приключение.',
    loginIntro: 'Анонимные регистрации установок и токены, о которых сообщили модели.',
    adminKey: 'Ключ администратора',
    signIn: 'Открыть панель',
    keyNote: 'Ключ используется только для начала сеанса и не сохраняется в хранилище браузера.',
    overview: 'Обзор',
    overviewIntro: 'Анонимные сводные данные о тенденциях использования спутника.',
    refresh: 'Обновить',
    exportCsv: 'Экспорт сводного CSV',
    signOut: 'Выйти',
    autoRefresh: 'Обновление каждые 60 секунд',
    installs: 'Зарегистрированные установки',
    installsHint: 'Регистрации при первом запуске · не число людей',
    active5m: 'Активны за последние 5 минут',
    reportedTotal: 'Сообщённые токены, всего',
    lifetime: 'За всё время сервера · только сообщённые значения',
    inputTokens: 'Входные токены',
    outputTokens: 'Выходные токены',
    unknownUsage: 'Генерации с неизвестным расходом',
    unknownHint: 'Генерации SDK без допустимых данных о токенах',
    chartTitle: 'Динамика сообщённых токенов',
    chartHint: 'По дню получения сервером (UTC). Выбранный период относится только к этому графику.',
    period: 'Период графика',
    days7: '7 дней',
    days30: '30 дней',
    days90: '90 дней',
    noTokens: 'За этот период общий расход токенов не сообщён. Входные или выходные значения могут быть указаны отдельно.',
    chartFooter: 'Провайдер сообщает итог независимо; он может отличаться от суммы известных входных и выходных токенов.',
    coverageTitle: 'Охват отчётов за всё время',
    coverageHint: 'Охват означает, что генерация SDK вернула поле, а не что учтены все внутренние раунды инструментов.',
    versionsTitle: 'Версии клиента',
    versionsHint: 'По последней версии, сообщённой каждой зарегистрированной установкой.',
    version: 'Версия',
    registrations: 'Регистрации',
    share: 'Доля',
    noVersions: 'Установок пока нет.',
    readingTitle: 'Как понимать эти числа',
    readingInstalls: 'Установки — это регистрации при первом запуске, а не уникальные люди. Переустановка или другая папка профиля может создать новую регистрацию.',
    readingTrust: 'Данные поступают от клиентов и могут быть подделаны. Они подходят для наблюдения за тенденциями, но не для счетов или аудита.',
    readingMissing: 'Суммируются только токены, возвращённые провайдером. Отсутствующие поля остаются неизвестными, без оценок и подстановки нулей. TTS/ASR без данных о токенах исключены.',
    readingRequests: 'Одна запись соответствует одной генерации SDK, которая может включать несколько HTTP-раундов инструментов. Наличие отчёта не гарантирует полноту каждого раунда.',
    privacy: 'Только сводные данные. Идентификаторы установок, IP, персонажи, диалоги и ключи не отображаются.',
    connecting: 'Подключение…',
    connected: 'Подключено · сводка обновлена',
    signInNeeded: 'Введите ключ администратора для просмотра данных.',
    sessionExpired: 'Сеанс истёк. Войдите снова.',
    signingIn: 'Вход…',
    loadFailed: 'Ошибка запроса. Повторите позже.',
    rateLimited: 'Слишком много запросов. Повторите позже.',
    invalidData: 'Недопустимый формат статистики.',
    updating: 'Обновление…',
    updatedAt: 'Обновлено: {time} (местное время)',
    active24h: 'Активны за последние 24 часа: {count}',
    requests: 'Записи генераций SDK',
    anyUsage: 'Сообщено хотя бы одно поле',
    inputCoverage: 'Сообщено входное поле',
    outputCoverage: 'Сообщено выходное поле',
    totalCoverage: 'Сообщён итог',
    chartDay: 'Дата (UTC)',
    signedOut: 'Выход выполнен. Данные страницы очищены.',
    logoutFailed: 'Не удалось выйти. Обновите страницу и повторите.',
    category: 'Категория',
    metric: 'Показатель',
    value: 'Значение',
    periodDays: 'Дней на графике',
    snapshotAt: 'Время снимка (UTC)',
    overall: 'Итоги за всё время',
    stale: 'Ошибка запроса. Показан последний успешный снимок.',
    noScript: 'Включите JavaScript для просмотра панели.'
  },
  th: {
    brand: 'ภูตคู่หู WoW · ศูนย์ข้อมูล',
    language: 'ภาษา',
    console: 'คอนโซลผู้ดูแล',
    loginTitle: 'มองย้อนทุกการผจญภัยที่มีร่วมกัน',
    loginIntro: 'ดูการลงทะเบียนติดตั้งแบบไม่ระบุตัวตนและโทเคนที่โมเดลรายงาน',
    adminKey: 'คีย์ผู้ดูแลระบบ',
    signIn: 'เปิดแดชบอร์ด',
    keyNote: 'คีย์ใช้เริ่มเซสชันนี้เท่านั้น และจะไม่ถูกเก็บในพื้นที่จัดเก็บของเบราว์เซอร์',
    overview: 'ภาพรวมการทำงาน',
    overviewIntro: 'ข้อมูลสรุปแบบไม่ระบุตัวตนสำหรับดูแนวโน้มการใช้งานคู่หู',
    refresh: 'รีเฟรช',
    exportCsv: 'ส่งออก CSV สรุป',
    signOut: 'ออกจากระบบ',
    autoRefresh: 'รีเฟรชอัตโนมัติทุก 60 วินาที',
    installs: 'การติดตั้งที่ลงทะเบียน',
    installsHint: 'ลงทะเบียนเมื่อเปิดครั้งแรก · ไม่ใช่จำนวนคน',
    active5m: 'ใช้งานในช่วง 5 นาทีล่าสุด',
    reportedTotal: 'โทเคนรวมที่รายงาน',
    lifetime: 'สะสมของเซิร์ฟเวอร์ · เฉพาะค่าที่รายงาน',
    inputTokens: 'โทเคนขาเข้า',
    outputTokens: 'โทเคนขาออก',
    unknownUsage: 'การสร้างที่ไม่ทราบการใช้',
    unknownHint: 'การสร้างของ SDK ที่ไม่มีจำนวนโทเคนที่ใช้ได้',
    chartTitle: 'แนวโน้มโทเคนที่รายงาน',
    chartHint: 'แยกตามวันที่เซิร์ฟเวอร์รับข้อมูล (UTC) ช่วงเวลาที่เลือกมีผลต่อกราฟนี้เท่านั้น',
    period: 'ช่วงเวลาของกราฟ',
    days7: '7 วัน',
    days30: '30 วัน',
    days90: '90 วัน',
    noTokens: 'ยังไม่มีโทเคนรวมที่รายงานในช่วงนี้ อาจมีการรายงานขาเข้าหรือขาออกแยกต่างหาก',
    chartFooter: 'ผู้ให้บริการรายงานยอดรวมแยกต่างหาก จึงอาจไม่เท่ากับผลรวมขาเข้าและขาออกที่ทราบ',
    coverageTitle: 'ความครอบคลุมของรายงานสะสม',
    coverageHint: 'ความครอบคลุมหมายถึงการสร้างของ SDK ส่งฟิลด์กลับมา ไม่ได้ยืนยันว่าทุกรอบเครื่องมือภายในถูกนับแล้ว',
    versionsTitle: 'เวอร์ชันของไคลเอนต์',
    versionsHint: 'จัดกลุ่มตามเวอร์ชันล่าสุดที่แต่ละการติดตั้งรายงาน',
    version: 'เวอร์ชัน',
    registrations: 'การลงทะเบียน',
    share: 'สัดส่วน',
    noVersions: 'ยังไม่มีการติดตั้งที่ลงทะเบียน',
    readingTitle: 'การตีความตัวเลขเหล่านี้',
    readingInstalls: 'จำนวนการติดตั้งคือการลงทะเบียนเมื่อเปิดครั้งแรก ไม่ใช่ผู้ใช้ที่ไม่ซ้ำกัน การติดตั้งใหม่หรือเปลี่ยนโฟลเดอร์โปรไฟล์อาจสร้างการลงทะเบียนใหม่',
    readingTrust: 'ไคลเอนต์เป็นผู้รายงานข้อมูลและอาจปลอมแปลงได้ ใช้ดูแนวโน้มเท่านั้น ไม่ใช่ใบเรียกเก็บเงินหรือหลักฐานการตรวจสอบ',
    readingMissing: 'รวมเฉพาะจำนวนโทเคนที่ผู้ให้บริการส่งกลับ ฟิลด์ที่หายไปยังถือว่าไม่ทราบ ไม่มีการประมาณหรือแทนด้วยศูนย์ ไม่รวม TTS/ASR ที่ไม่มีโทเคน',
    readingRequests: 'หนึ่งระเบียนหมายถึงการสร้างของ SDK หนึ่งครั้ง ซึ่งอาจมีรอบเครื่องมือ HTTP หลายรอบ การมีรายงานไม่ได้ยืนยันว่าครบทุก ๆ รอบ',
    privacy: 'แสดงเฉพาะข้อมูลสรุป ไม่แสดงรหัสการติดตั้ง IP ตัวละคร บทสนทนา หรือคีย์',
    connecting: 'กำลังเชื่อมต่อ…',
    connected: 'เชื่อมต่อแล้ว · อัปเดตข้อมูลสรุปแล้ว',
    signInNeeded: 'กรอกคีย์ผู้ดูแลระบบเพื่อดูข้อมูล',
    sessionExpired: 'เซสชันหมดอายุ โปรดเข้าสู่ระบบอีกครั้ง',
    signingIn: 'กำลังเข้าสู่ระบบ…',
    loadFailed: 'คำขอล้มเหลว โปรดลองใหม่ภายหลัง',
    rateLimited: 'ส่งคำขอมากเกินไป โปรดลองใหม่ภายหลัง',
    invalidData: 'รูปแบบข้อมูลสถิติไม่ถูกต้อง',
    updating: 'กำลังรีเฟรช…',
    updatedAt: 'อัปเดตเมื่อ {time} (เวลาท้องถิ่น)',
    active24h: 'ใช้งานในช่วง 24 ชั่วโมงล่าสุด: {count}',
    requests: 'ระเบียนการสร้างของ SDK',
    anyUsage: 'รายงานฟิลด์การใช้อย่างน้อยหนึ่งฟิลด์',
    inputCoverage: 'รายงานฟิลด์ขาเข้า',
    outputCoverage: 'รายงานฟิลด์ขาออก',
    totalCoverage: 'รายงานฟิลด์ยอดรวม',
    chartDay: 'วันที่ (UTC)',
    signedOut: 'ออกจากระบบแล้ว ล้างข้อมูลในหน้านี้แล้ว',
    logoutFailed: 'ออกจากระบบไม่สำเร็จ โปรดรีเฟรชแล้วลองใหม่',
    category: 'หมวดหมู่',
    metric: 'ตัวชี้วัด',
    value: 'ค่า',
    periodDays: 'จำนวนวันของกราฟ',
    snapshotAt: 'เวลาของภาพรวม (UTC)',
    overall: 'ยอดสะสม',
    stale: 'คำขอล้มเหลว กำลังแสดงภาพรวมที่สำเร็จล่าสุด',
    noScript: 'เปิดใช้งาน JavaScript เพื่อดูแดชบอร์ด'
  },
  vi: {
    brand: 'Tinh linh đồng hành WoW · Trung tâm dữ liệu',
    language: 'Ngôn ngữ',
    console: 'Bảng quản trị',
    loginTitle: 'Nhìn lại từng chuyến phiêu lưu cùng nhau.',
    loginIntro: 'Xem đăng ký cài đặt ẩn danh và số token do mô hình báo cáo.',
    adminKey: 'Khóa quản trị',
    signIn: 'Mở bảng điều khiển',
    keyNote: 'Khóa chỉ dùng để bắt đầu phiên này và không được giữ trong bộ nhớ trình duyệt.',
    overview: 'Tổng quan hoạt động',
    overviewIntro: 'Dữ liệu tổng hợp ẩn danh để hiểu xu hướng sử dụng tinh linh.',
    refresh: 'Làm mới',
    exportCsv: 'Xuất CSV tổng hợp',
    signOut: 'Đăng xuất',
    autoRefresh: 'Tự động làm mới mỗi 60 giây',
    installs: 'Lượt cài đặt đã đăng ký',
    installsHint: 'Đăng ký khi chạy lần đầu · không phải số người',
    active5m: 'Hoạt động trong 5 phút qua',
    reportedTotal: 'Tổng token đã báo cáo',
    lifetime: 'Lũy kế máy chủ · chỉ số đã báo cáo',
    inputTokens: 'Token đầu vào',
    outputTokens: 'Token đầu ra',
    unknownUsage: 'Lần sinh chưa rõ mức sử dụng',
    unknownHint: 'Lần sinh của SDK không trả về số token hợp lệ',
    chartTitle: 'Xu hướng token đã báo cáo',
    chartHint: 'Theo ngày máy chủ nhận dữ liệu (UTC). Khoảng thời gian chỉ áp dụng cho biểu đồ này.',
    period: 'Khoảng thời gian biểu đồ',
    days7: '7 ngày',
    days30: '30 ngày',
    days90: '90 ngày',
    noTokens: 'Chưa có tổng token được báo cáo trong khoảng này. Đầu vào hoặc đầu ra có thể được báo cáo riêng.',
    chartFooter: 'Nhà cung cấp báo cáo tổng riêng, nên tổng có thể khác tổng số đầu vào và đầu ra đã biết.',
    coverageTitle: 'Độ bao phủ báo cáo lũy kế',
    coverageHint: 'Độ bao phủ cho biết lần sinh SDK đã trả về một trường, không xác nhận mọi lượt công cụ nội bộ đều được tính.',
    versionsTitle: 'Phân bố phiên bản ứng dụng',
    versionsHint: 'Theo phiên bản gần nhất mà mỗi bản cài đặt đã đăng ký báo cáo.',
    version: 'Phiên bản',
    registrations: 'Lượt đăng ký',
    share: 'Tỷ lệ',
    noVersions: 'Chưa có bản cài đặt đăng ký.',
    readingTitle: 'Cách hiểu các số liệu',
    readingInstalls: 'Số bản cài đặt là số đăng ký khi chạy lần đầu, không phải số người dùng duy nhất. Cài lại hoặc đổi thư mục hồ sơ có thể tạo đăng ký mới.',
    readingTrust: 'Dữ liệu do ứng dụng tự báo cáo và có thể bị làm giả. Chỉ dùng theo dõi xu hướng, không dùng làm hóa đơn hay bằng chứng kiểm toán.',
    readingMissing: 'Chỉ cộng số token nhà cung cấp thực sự trả về. Trường thiếu vẫn là chưa biết, không ước tính hay thay bằng 0. TTS/ASR không có token sẽ bị loại trừ.',
    readingRequests: 'Một bản ghi tương ứng một lần sinh SDK, có thể gồm nhiều lượt công cụ HTTP. Có báo cáo không đồng nghĩa mọi lượt đều đầy đủ.',
    privacy: 'Chỉ hiển thị dữ liệu tổng hợp, không có mã cài đặt, IP, nhân vật, hội thoại hay khóa.',
    connecting: 'Đang kết nối…',
    connected: 'Đã kết nối · đã cập nhật tổng hợp',
    signInNeeded: 'Nhập khóa quản trị để xem dữ liệu.',
    sessionExpired: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
    signingIn: 'Đang đăng nhập…',
    loadFailed: 'Yêu cầu thất bại. Vui lòng thử lại sau.',
    rateLimited: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    invalidData: 'Định dạng thống kê không hợp lệ.',
    updating: 'Đang làm mới…',
    updatedAt: 'Cập nhật: {time} (giờ địa phương)',
    active24h: 'Hoạt động trong 24 giờ qua: {count}',
    requests: 'Bản ghi sinh của SDK',
    anyUsage: 'Có ít nhất một trường được báo cáo',
    inputCoverage: 'Có trường đầu vào',
    outputCoverage: 'Có trường đầu ra',
    totalCoverage: 'Có trường tổng',
    chartDay: 'Ngày (UTC)',
    signedOut: 'Đã đăng xuất và xóa dữ liệu trên trang.',
    logoutFailed: 'Đăng xuất thất bại. Hãy làm mới và thử lại.',
    category: 'Danh mục',
    metric: 'Chỉ số',
    value: 'Giá trị',
    periodDays: 'Số ngày biểu đồ',
    snapshotAt: 'Thời gian chụp dữ liệu (UTC)',
    overall: 'Tổng lũy kế',
    stale: 'Yêu cầu thất bại. Đang hiển thị bản chụp thành công gần nhất.',
    noScript: 'Bật JavaScript để xem bảng điều khiển.'
  }
};

const localeTags = { zhHans: 'zh-CN', zhHant: 'zh-TW', en: 'en', es: 'es', fr: 'fr', it: 'it', pt: 'pt', ja: 'ja', ko: 'ko', ru: 'ru', th: 'th', vi: 'vi' };
const counterKeys = ['requests', 'requestsWithUsage', 'requestsWithoutUsage', 'inputTokens', 'outputTokens', 'totalTokens', 'inputReportedRequests', 'outputReportedRequests', 'totalReportedRequests'];
const counterLabels = { requests: 'requests', requestsWithUsage: 'anyUsage', requestsWithoutUsage: 'unknownUsage', inputTokens: 'inputTokens', outputTokens: 'outputTokens', totalTokens: 'reportedTotal', inputReportedRequests: 'inputCoverage', outputReportedRequests: 'outputCoverage', totalReportedRequests: 'totalCoverage' };
const state = { language: detectLanguage(), days: 7, stats: null, authenticated: false, busy: false, epoch: 0, statusKey: 'connecting', statusError: false, controller: null };
const elements = Object.fromEntries(['language', 'status', 'login-panel', 'login-form', 'admin-key', 'login-button', 'dashboard', 'refresh', 'export', 'logout', 'updated-at', 'active-24h', 'coverage', 'versions', 'versions-empty', 'token-chart', 'chart-empty'].map(id => [id, document.getElementById(id)]));

function detectLanguage() {
  for (const preference of navigator.languages || [navigator.language]) {
    const language = preference.toLowerCase();
    if (language.startsWith('zh')) return /(?:hant|tw|hk|mo)/.test(language) ? 'zhHant' : 'zhHans';
    const base = language.split('-')[0];
    if (Object.hasOwn(translations, base)) return base;
  }
  return 'zhHans';
}

function t(key, parameters = {}) {
  let text = translations[state.language][key];
  for (const [name, value] of Object.entries(parameters)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

function formatNumber(value) { return new Intl.NumberFormat(localeTags[state.language]).format(value); }
function formatPercent(value, total) { return new Intl.NumberFormat(localeTags[state.language], { style: 'percent', maximumFractionDigits: 1 }).format(total > 0 ? value / total : 0); }

function setStatus(key, error = false) {
  state.statusKey = key;
  state.statusError = error;
  elements.status.textContent = t(key);
  elements.status.classList.toggle('error', error);
}

function applyLanguage() {
  document.documentElement.lang = localeTags[state.language];
  document.title = t('brand');
  elements.language.value = state.language;
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
  setStatus(state.statusKey, state.statusError);
  if (state.stats) renderStats();
}

function setBusy(busy) {
  state.busy = busy;
  elements['login-button'].disabled = busy;
  elements.refresh.disabled = busy;
  elements.export.disabled = busy || !state.stats;
  document.querySelectorAll('[data-days]').forEach(button => { button.disabled = busy; });
  elements.dashboard.setAttribute('aria-busy', String(busy));
}

function clearPrivateDisplay(statusKey) {
  state.epoch += 1;
  state.controller?.abort();
  state.controller = null;
  state.authenticated = false;
  state.stats = null;
  elements.dashboard.hidden = true;
  elements['login-panel'].hidden = false;
  elements['admin-key'].value = '';
  document.querySelectorAll('[data-value]').forEach(element => { element.textContent = ''; });
  for (const id of ['updated-at', 'active-24h', 'coverage', 'versions', 'token-chart']) elements[id].replaceChildren();
  setBusy(false);
  setStatus(statusKey, statusKey === 'sessionExpired');
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalidData');
  return value;
}

function readCounters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalidData');
  return Object.fromEntries(counterKeys.map(key => [key, safeCount(value[key])]));
}

function readStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.daily) || !Array.isArray(value.versions)) throw new Error('invalidData');
  if (typeof value.generatedAt !== 'string' || value.generatedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('invalidData');
  if (safeCount(value.periodDays) < 1 || value.periodDays > 90 || value.daily.length !== value.periodDays || value.versions.length > 10000) throw new Error('invalidData');
  const daily = value.daily.map(row => {
    if (!row || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isFinite(Date.parse(`${row.day}T00:00:00Z`))) throw new Error('invalidData');
    return { day: row.day, ...readCounters(row) };
  });
  if (new Set(daily.map(row => row.day)).size !== daily.length) throw new Error('invalidData');
  return {
    totalInstallations: safeCount(value.totalInstallations), activeInstallations5m: safeCount(value.activeInstallations5m), activeInstallations24h: safeCount(value.activeInstallations24h),
    generatedAt: value.generatedAt, periodDays: value.periodDays, totals: readCounters(value.totals), daily: daily.sort((a, b) => a.day.localeCompare(b.day)),
    versions: value.versions.map(row => {
      if (!row || typeof row.version !== 'string' || row.version.length > 64) throw new Error('invalidData');
      return { version: row.version, installations: safeCount(row.installations) };
    }).sort((a, b) => b.installations - a.installations || a.version.localeCompare(b.version))
  };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  state.controller = controller;
  try {
    return await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timeout);
    if (state.controller === controller) state.controller = null;
  }
}

async function refreshStats(initial = false) {
  if (state.busy) return;
  const epoch = state.epoch;
  setBusy(true);
  setStatus(initial ? 'connecting' : 'updating');
  try {
    const response = await request(`/api/v1/admin/stats?days=${state.days}`);
    if (epoch !== state.epoch) return;
    if (response.status === 401) {
      clearPrivateDisplay(state.authenticated ? 'sessionExpired' : 'signInNeeded');
      return;
    }
    if (!response.ok) {
      setStatus(response.status === 429 ? 'rateLimited' : state.stats ? 'stale' : 'loadFailed', true);
      return;
    }
    const stats = readStats(await response.json());
    if (epoch !== state.epoch) return;
    state.stats = stats;
    state.authenticated = true;
    elements['login-panel'].hidden = true;
    elements.dashboard.hidden = false;
    renderStats();
    setStatus('connected');
  } catch (error) {
    if (epoch === state.epoch) setStatus(error instanceof Error && error.message === 'invalidData' ? 'invalidData' : state.stats ? 'stale' : 'loadFailed', true);
  } finally {
    if (epoch === state.epoch) setBusy(false);
  }
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  document.querySelectorAll('[data-value]').forEach(element => { element.textContent = formatNumber(stats[element.dataset.value] ?? stats.totals[element.dataset.value]); });
  const time = new Intl.DateTimeFormat(localeTags[state.language], { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(stats.generatedAt));
  elements['updated-at'].textContent = t('updatedAt', { time });
  elements['active-24h'].textContent = t('active24h', { count: formatNumber(stats.activeInstallations24h) });
  document.querySelectorAll('[data-days]').forEach(button => { button.setAttribute('aria-pressed', String(Number(button.dataset.days) === stats.periodDays)); });
  renderChart(stats.daily);
  renderCoverage(stats.totals);
  elements.versions.replaceChildren();
  for (const version of stats.versions) {
    const row = document.createElement('tr');
    for (const [index, value] of [version.version, formatNumber(version.installations), formatPercent(version.installations, stats.totalInstallations)].entries()) {
      const cell = document.createElement('td');
      if (index > 0) cell.className = 'number';
      cell.textContent = value;
      row.append(cell);
    }
    elements.versions.append(row);
  }
  elements['versions-empty'].hidden = stats.versions.length > 0;
}

function renderCoverage(totals) {
  elements.coverage.replaceChildren();
  for (const [key, label] of [['requests', 'requests'], ['requestsWithUsage', 'anyUsage'], ['inputReportedRequests', 'inputCoverage'], ['outputReportedRequests', 'outputCoverage'], ['totalReportedRequests', 'totalCoverage']]) {
    const row = document.createElement('div');
    row.className = 'coverage-row';
    const term = document.createElement('dt');
    term.textContent = t(label);
    const value = document.createElement('dd');
    value.textContent = key === 'requests' ? formatNumber(totals[key]) : `${formatNumber(totals[key])} / ${formatNumber(totals.requests)} · ${formatPercent(totals[key], totals.requests)}`;
    row.append(term, value);
    if (key !== 'requests') {
      const progress = document.createElement('progress');
      progress.max = Math.max(totals.requests, 1);
      progress.value = totals[key];
      progress.setAttribute('aria-label', t(label));
      row.append(progress);
    }
    elements.coverage.append(row);
  }
}

function svgElement(name, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
}

function renderChart(daily) {
  const chart = elements['token-chart'];
  chart.replaceChildren();
  const maximum = Math.max(0, ...daily.map(day => day.totalTokens));
  chart.toggleAttribute('hidden', maximum === 0);
  elements['chart-empty'].hidden = maximum !== 0;
  if (maximum === 0) return;
  const logicalWidth = Math.max(280, chart.parentElement.clientWidth);
  chart.setAttribute('viewBox', `0 0 ${logicalWidth} 280`);
  const left = 66, top = 16, width = logicalWidth - 84, height = 220;
  const scaleMaximum = maximum * 1.1;
  const compact = new Intl.NumberFormat(localeTags[state.language], { notation: 'compact', maximumFractionDigits: 1 });
  for (let index = 0; index <= 4; index += 1) {
    const y = top + height - index * height / 4;
    chart.append(svgElement('line', { x1: left, x2: left + width, y1: y, y2: y, class: 'chart-grid' }));
    chart.append(svgElement('text', { x: left - 13, y: y + 4, 'text-anchor': 'end', class: 'chart-label' }, compact.format(scaleMaximum * index / 4)));
  }
  const step = width / daily.length;
  const labelCount = Math.min(daily.length, logicalWidth < 600 ? 3 : 7);
  const labelIndices = new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (daily.length - 1) / Math.max(labelCount - 1, 1))));
  daily.forEach((day, index) => {
    const barHeight = day.totalTokens / scaleMaximum * height;
    const bar = svgElement('rect', { x: left + index * step + Math.min(step * .18, 6), y: top + height - barHeight, width: Math.max(1, step - Math.min(step * .36, 12)), height: barHeight, class: 'chart-bar', tabindex: '0', role: 'img' });
    const description = `${day.day} UTC · ${t('reportedTotal')}: ${formatNumber(day.totalTokens)} · ${t('inputTokens')}: ${formatNumber(day.inputTokens)} · ${t('outputTokens')}: ${formatNumber(day.outputTokens)}`;
    bar.setAttribute('aria-label', description);
    bar.append(svgElement('title', {}, description));
    chart.append(bar);
    if (labelIndices.has(index)) {
      const date = new Intl.DateTimeFormat(localeTags[state.language], { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.day}T00:00:00Z`));
      chart.append(svgElement('text', { x: left + (index + .5) * step, y: top + height + 28, 'text-anchor': 'middle', class: 'chart-label' }, date));
    }
  });
}

function csvCell(value) {
  let text = String(value);
  // Spreadsheet programs execute formula-like cells even when CSV-quoted.
  if (/^\s*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const stats = state.stats;
  if (!stats) return;
  const rows = [[t('category'), t('chartDay'), t('version'), t('metric'), t('value')]];
  for (const [label, value] of [['installs', stats.totalInstallations], ['active5m', stats.activeInstallations5m], ['active24h', stats.activeInstallations24h], ['periodDays', stats.periodDays], ['snapshotAt', stats.generatedAt]]) rows.push([t('overall'), '', '', t(label).replace(': {count}', '').replace('：{count}', '').replace('{count}', '').trim(), value]);
  for (const key of counterKeys) rows.push([t('overall'), '', '', t(counterLabels[key]), stats.totals[key]]);
  for (const day of stats.daily) for (const key of counterKeys) rows.push([t('chartTitle'), day.day, '', t(counterLabels[key]), day[key]]);
  for (const version of stats.versions) rows.push([t('versionsTitle'), '', version.version, t('registrations'), version.installations]);
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `wow-companion-stats-${stats.generatedAt.slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

elements.language.addEventListener('change', () => {
  if (!Object.hasOwn(translations, elements.language.value)) return;
  state.language = elements.language.value;
  applyLanguage();
});
elements['login-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const key = elements['admin-key'].value;
  elements['admin-key'].value = '';
  if (!key) return;
  const epoch = state.epoch;
  setBusy(true);
  setStatus('signingIn');
  try {
    const response = await request('/api/v1/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    if (epoch !== state.epoch) return;
    if (!response.ok) {
      setStatus(response.status === 401 ? 'signInNeeded' : response.status === 429 ? 'rateLimited' : 'loadFailed', true);
      return;
    }
    state.authenticated = true;
  } catch {
    if (epoch === state.epoch) setStatus('loadFailed', true);
    return;
  } finally {
    if (epoch === state.epoch) setBusy(false);
  }
  if (epoch === state.epoch) await refreshStats();
});
elements.refresh.addEventListener('click', () => { void refreshStats(); });
elements.export.addEventListener('click', exportCsv);
document.querySelectorAll('[data-days]').forEach(button => {
  button.addEventListener('click', () => {
    state.days = Number(button.dataset.days);
    void refreshStats();
  });
});
elements.logout.addEventListener('click', async () => {
  clearPrivateDisplay('signedOut');
  const epoch = state.epoch;
  try {
    const response = await request('/api/v1/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (epoch === state.epoch && !response.ok && response.status !== 401) setStatus('logoutFailed', true);
  } catch {
    if (epoch === state.epoch) setStatus('logoutFailed', true);
  }
});

applyLanguage();
void refreshStats(true);
setInterval(() => { if (state.authenticated && !state.busy) void refreshStats(); }, 60000);
let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (state.stats) renderChart(state.stats.daily); });
});
