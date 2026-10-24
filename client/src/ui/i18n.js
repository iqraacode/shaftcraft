// Menu translations. Strings not in a dictionary fall back to English.
export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'ar', name: 'العربية', rtl: true },
];

const T = {
  fr: {
    Singleplayer: 'Solo', Multiplayer: 'Multijoueur', 'Options...': 'Options...', 'Dressing Room': 'Cabine', 'Quit Game': 'Quitter', Language: 'Langue',
    'Select World': 'Choisir un monde', 'Play Selected World': 'Jouer au monde', 'Create New World': 'Créer un monde', Rename: 'Renommer', Delete: 'Supprimer', Back: 'Retour', Cancel: 'Annuler', Done: 'Terminé',
    'World Name': 'Nom du monde', 'Seed for the World Generator': 'Graine du générateur', 'Game Mode': 'Mode de jeu', Difficulty: 'Difficulté', 'Allow Commands': 'Commandes', 'World Type': 'Type de monde',
    'Play Multiplayer': 'Jouer en multijoueur', 'Join Server': 'Rejoindre', 'Direct Connect': 'Connexion directe', 'Add Server': 'Ajouter', Edit: 'Modifier', Refresh: 'Actualiser',
    'Server Name': 'Nom du serveur', 'Server Address': 'Adresse du serveur', Options: 'Options', 'Video Settings...': 'Vidéo...', 'Controls...': 'Commandes...', 'Music & Sounds...': 'Musique et sons...', 'Chat Settings...': 'Chat...',
    'Game Menu': 'Menu du jeu', 'Back to Game': 'Retour au jeu', 'Save and Quit to Title': 'Sauvegarder et quitter', Disconnect: 'Déconnexion', 'Game paused': 'Jeu en pause',
    'You died!': 'Vous êtes mort !', Respawn: 'Réapparaître', 'Title Screen': 'Écran titre', 'Spectate World': 'Observer le monde', 'Delete World': 'Supprimer le monde', 'Leave Server': 'Quitter le serveur',
    'Sign In': 'Connexion', 'Enter user name': "Entrez le nom d'utilisateur", 'Full name': 'Nom complet', 'Sign in to play multiplayer': 'Connectez-vous pour jouer en multijoueur', 'Sign Out': 'Déconnexion', 'Signed in as': 'Connecté en tant que',
    'Click to play': 'Cliquez pour jouer', Camera: 'Caméra', 'Leave Bed': 'Quitter le lit', Close: 'Fermer', Trade: 'Échanger',
  },
  es: {
    Singleplayer: 'Un jugador', Multiplayer: 'Multijugador', 'Options...': 'Opciones...', 'Dressing Room': 'Vestidor', 'Quit Game': 'Salir', Language: 'Idioma',
    'Select World': 'Elegir mundo', 'Play Selected World': 'Jugar mundo', 'Create New World': 'Crear mundo', Rename: 'Renombrar', Delete: 'Borrar', Back: 'Volver', Cancel: 'Cancelar', Done: 'Listo',
    'World Name': 'Nombre del mundo', 'Seed for the World Generator': 'Semilla del generador', 'Game Mode': 'Modo de juego', Difficulty: 'Dificultad', 'Allow Commands': 'Comandos', 'World Type': 'Tipo de mundo',
    'Play Multiplayer': 'Jugar multijugador', 'Join Server': 'Unirse', 'Direct Connect': 'Conexión directa', 'Add Server': 'Añadir', Edit: 'Editar', Refresh: 'Actualizar',
    'Server Name': 'Nombre del servidor', 'Server Address': 'Dirección del servidor', Options: 'Opciones', 'Video Settings...': 'Vídeo...', 'Controls...': 'Controles...', 'Music & Sounds...': 'Música y sonidos...', 'Chat Settings...': 'Chat...',
    'Game Menu': 'Menú del juego', 'Back to Game': 'Volver al juego', 'Save and Quit to Title': 'Guardar y salir', Disconnect: 'Desconectar', 'Game paused': 'Juego en pausa',
    'You died!': '¡Has muerto!', Respawn: 'Reaparecer', 'Title Screen': 'Pantalla de título', 'Spectate World': 'Observar el mundo', 'Delete World': 'Borrar mundo', 'Leave Server': 'Salir del servidor',
    'Sign In': 'Iniciar sesión', 'Enter user name': 'Introduce el nombre de usuario', 'Full name': 'Nombre completo', 'Sign in to play multiplayer': 'Inicia sesión para jugar multijugador', 'Sign Out': 'Cerrar sesión', 'Signed in as': 'Sesión de',
    'Click to play': 'Haz clic para jugar', Camera: 'Cámara', 'Leave Bed': 'Levantarse', Close: 'Cerrar', Trade: 'Comerciar',
  },
  ar: {
    Singleplayer: 'لاعب واحد', Multiplayer: 'متعدد اللاعبين', 'Options...': 'الإعدادات...', 'Dressing Room': 'غرفة الملابس', 'Quit Game': 'خروج', Language: 'اللغة',
    'Select World': 'اختر عالما', 'Play Selected World': 'العب العالم المختار', 'Create New World': 'إنشاء عالم جديد', Rename: 'إعادة تسمية', Delete: 'حذف', Back: 'رجوع', Cancel: 'إلغاء', Done: 'تم',
    'World Name': 'اسم العالم', 'Seed for the World Generator': 'بذرة مولد العالم', 'Game Mode': 'نمط اللعب', Difficulty: 'الصعوبة', 'Allow Commands': 'السماح بالأوامر', 'World Type': 'نوع العالم',
    'Play Multiplayer': 'العب مع الآخرين', 'Join Server': 'انضمام', 'Direct Connect': 'اتصال مباشر', 'Add Server': 'إضافة خادم', Edit: 'تعديل', Refresh: 'تحديث',
    'Server Name': 'اسم الخادم', 'Server Address': 'عنوان الخادم', Options: 'الإعدادات', 'Video Settings...': 'الصورة...', 'Controls...': 'التحكم...', 'Music & Sounds...': 'الموسيقى والأصوات...', 'Chat Settings...': 'الدردشة...',
    'Game Menu': 'قائمة اللعبة', 'Back to Game': 'العودة إلى اللعبة', 'Save and Quit to Title': 'حفظ والخروج', Disconnect: 'قطع الاتصال', 'Game paused': 'اللعبة متوقفة',
    'You died!': 'لقد مت!', Respawn: 'إحياء', 'Title Screen': 'الشاشة الرئيسية', 'Spectate World': 'مشاهدة العالم', 'Delete World': 'حذف العالم', 'Leave Server': 'مغادرة الخادم',
    'Sign In': 'تسجيل الدخول', 'Enter user name': 'أدخل اسم المستخدم', 'Full name': 'الاسم الكامل', 'Sign in to play multiplayer': 'سجل الدخول للعب مع الآخرين', 'Sign Out': 'تسجيل الخروج', 'Signed in as': 'مسجل باسم',
    'Click to play': 'انقر للعب', Camera: 'الكاميرا', 'Leave Bed': 'مغادرة السرير', Close: 'إغلاق', Trade: 'مقايضة',
  },
};

let current = 'en';
export function setLanguage(id) {
  current = T[id] || id === 'en' ? id : 'en';
  const lang = LANGUAGES.find((l) => l.id === current);
  document.documentElement.lang = current;
  document.documentElement.dir = lang && lang.rtl ? 'rtl' : 'ltr';
}
export function tr(s) {
  if (typeof s !== 'string' || current === 'en') return s;
  const d = T[current];
  return (d && d[s]) || s;
}
