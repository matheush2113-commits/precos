import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  StatusBar, Animated, ActivityIndicator,
  Dimensions, TextInput, FlatList, ScrollView, KeyboardAvoidingView,
  Platform, Modal, Switch, Easing, Keyboard, Image, Linking, Appearance, AppState, PermissionsAndroid, Vibration
} from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { CameraView, Camera } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
// ─── SAFESTORE: COMPATÍVEL COM WEB (CHROME) E DEVICE ───────────────────────
// expo-secure-store não suporta web — usamos localStorage como fallback.
const SafeStore = {
  getItemAsync: async (key) => {
    if (Platform.OS === 'web') {
      try { return window.localStorage.getItem(key); } catch { return null; }
    }
    try { return await SecureStore.getItemAsync(key); } catch { return null; }
  },
  setItemAsync: async (key, value) => {
    if (Platform.OS === 'web') {
      try { window.localStorage.setItem(key, value); } catch { /* noop */ }
      return;
    }
    try { await SecureStore.setItemAsync(key, value); } catch { /* noop */ }
  },
  deleteItemAsync: async (key) => {
    if (Platform.OS === 'web') {
      try { window.localStorage.removeItem(key); } catch { /* noop */ }
      return;
    }
    try { await SecureStore.deleteItemAsync(key); } catch { /* noop */ }
  },
};

import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import QRCode from 'react-native-qrcode-svg';
import axios from 'axios';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

// ─── NOTIFICAÇÕES: configuração global ──────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── ONESIGNAL — PUSH NOTIFICATIONS ────────────────────────────────────────
// Integração com OneSignal para receber notificações push do script Python.
// O script Python busca os vencimentos no Baserow e envia via API REST do OneSignal.
// O app só precisa: 1) inicializar, 2) registrar o externalUserId (usuário logado),
// 3) ouvir notificações recebidas e exibir no AppAlert.

let _oneSignalReady = false;
let _oneSignalUserId = null; // externalId do usuário logado (ex: ID do Baserow)

// Inicialização do OneSignal (chamada uma vez no App mount)
// Requer: react-native-onesignal instalado e ONESIGNAL_APP_ID configurado
const ONESIGNAL_APP_ID = 'ddbe0bb6-09cb-49f7-b408-59dedd8731ed'; // ← substitua pelo seu App ID do OneSignal

const initOneSignal = async () => {
  try {
    const { OneSignal } = await import('react-native-onesignal');

    // Inicializa
    OneSignal.initialize(ONESIGNAL_APP_ID);

    // Solicita permissão de push (iOS precisa, Android 13+ também)
    OneSignal.Notifications.requestPermission(true);

    // Listener: notificação recebida com app em primeiro plano
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      const notif  = event.notification;
      const title  = notif.title  || 'Notificação';
      const body   = notif.body   || '';
      const data   = notif.additionalData || {};

      // Previne exibição nativa duplicada — mostramos no AppAlert customizado
      event.preventDefault();

      // Detecta tipo pela data adicional (enviada pelo script Python)
      let type = 'warning';
      if (data.tipo === 'vencimento_critico') type = 'error';
      else if (data.tipo === 'vencimento_ok')  type = 'success';
      else if (data.tipo === 'previsao')        type = 'info';

      AppAlert.alert(title, body, [{ text: 'OK' }], { type });

      // Fala a notificação pelo ElevenLabs se app estiver ativo
      speakWithElevenLabs(`${title}. ${body}`, () => {});
    });

    // Listener: usuário tocou na notificação (app em background/fechado)
    OneSignal.Notifications.addEventListener('click', (event) => {
      const data = event?.notification?.additionalData || {};
      // Pode navegar para a prateleira correta, se tiver dado adicional
      if (data.shelf && typeof _oneSignalNavCallback === 'function') {
        _oneSignalNavCallback(data.shelf);
      }
    });

    _oneSignalReady = true;
    console.log('[OneSignal] Inicializado com sucesso.');
  } catch (e) {
    // react-native-onesignal não instalado ou Expo Go — silencia
    console.warn('[OneSignal] Não disponível:', e?.message);
  }
};

// Callback de navegação: preenchido pelo App ao montar
let _oneSignalNavCallback = null;
const setOneSignalNavCallback = (cb) => { _oneSignalNavCallback = cb; };

// Registra o usuário logado no OneSignal como External User ID
// O script Python usa esse mesmo ID para filtrar a quem enviar a notificação
const oneSignalLogin = async (externalUserId) => {
  if (!externalUserId) return;
  _oneSignalUserId = String(externalUserId);
  try {
    const { OneSignal } = await import('react-native-onesignal');
    // External ID = ID da linha do usuário no Baserow (userData.id)
    OneSignal.login(_oneSignalUserId);
    console.log('[OneSignal] Usuário registrado:', _oneSignalUserId);
  } catch { /* OneSignal não disponível */ }
};

// Remove o usuário ao fazer logout
const oneSignalLogout = async () => {
  _oneSignalUserId = null;
  try {
    const { OneSignal } = await import('react-native-onesignal');
    OneSignal.logout();
  } catch { /* noop */ }
};

// Tags úteis para segmentar notificações no script Python
// Ex: notificar só usuários de um perfil específico, ou de uma prateleira
const oneSignalSetTags = async (tags = {}) => {
  try {
    const { OneSignal } = await import('react-native-onesignal');
    OneSignal.User.addTags(tags);
    // Ex: { perfil: 'Gerente', area: 'Frios', loja: 'SP01' }
  } catch { /* noop */ }
};

// ─── CANAIS ANDROID PARA ONESIGNAL ──────────────────────────────────────────
// Esses IDs devem corresponder ao que o script Python envia no campo "android_channel_id"
const OS_CHANNEL_CRITICO    = 'vencimento_critico';   // vermelho, prioridade MAX
const OS_CHANNEL_ATENCAO    = 'vencimento_atencao';   // amarelo, prioridade HIGH
const OS_CHANNEL_PREVISAO   = 'vencimento_previsao';  // azul, prioridade DEFAULT
const OS_CHANNEL_SISTEMA    = 'sistema_geral';        // cinza, prioridade DEFAULT

// ─── EXPO-SPEECH-RECOGNITION: FALLBACK SEGURO PARA EXPO GO ────────────────────
let ExpoSpeechRecognitionModule = null;
let _useSpeechRecognitionEventReal = null;
let SPEECH_RECOGNITION_AVAILABLE = false;

try {
  const SpeechRecognitionLib = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = SpeechRecognitionLib.ExpoSpeechRecognitionModule;
  _useSpeechRecognitionEventReal = SpeechRecognitionLib.useSpeechRecognitionEvent;
  SPEECH_RECOGNITION_AVAILABLE = true;
  console.log('✅ expo-speech-recognition carregado com sucesso');
} catch (e) {
  console.warn('⚠️ expo-speech-recognition não disponível neste ambiente (Expo Go).');
  ExpoSpeechRecognitionModule = {
    requestPermissionsAsync: async () => ({ granted: false, canAskAgain: false }),
    start: async () => {},
    stop: async () => {},
  };
}

const useSpeechRecognitionEvent = (eventName, handler) => {
  const handlerRef = React.useRef(handler);
  React.useEffect(() => { handlerRef.current = handler; }, [handler]);
  React.useEffect(() => {
    if (!SPEECH_RECOGNITION_AVAILABLE || !_useSpeechRecognitionEventReal) return;
  }, [eventName]);
};

const _SafeSpeechEventWrapper = ({ eventName, onEvent }) => {
  if (!SPEECH_RECOGNITION_AVAILABLE || !_useSpeechRecognitionEventReal) return null;
  return <_InnerSpeechListener eventName={eventName} onEvent={onEvent} />;
};
const _InnerSpeechListener = ({ eventName, onEvent }) => {
  _useSpeechRecognitionEventReal(eventName, onEvent);
  return null;
};

// --- GIFs ---
import AchandoGif from './assets/achando.gif';
import RoboGif from './assets/analise.gif';

// ─── APP ALERT — MODAL CUSTOMIZADO (substitui Alert nativo) ─────────────────
// Estado global do AppAlert (sem context, para poder ser chamado de qualquer lugar)
let _appAlertRef = null;
export const AppAlertService = {
  _queue: [],
  show({ title, message, buttons, type = 'info', icon = null }) {
    const entry = { title, message, buttons, type, icon };
    if (_appAlertRef) {
      _appAlertRef.show(entry);
    } else {
      this._queue.push(entry);
    }
  },
  _flush(ref) {
    _appAlertRef = ref;
    while (this._queue.length > 0) {
      ref.show(this._queue.shift());
    }
  },
};

// Hook imperativo: useAppAlert()
// Retorna uma função showAlert(title, message, buttons?, type?) compatível com Alert.alert
const _createShowFn = () => (title, message, buttons, opts) => {
  AppAlertService.show({
    title,
    message,
    buttons: buttons || [{ text: 'OK' }],
    type: opts?.type || 'info',
    icon: opts?.icon || null,
  });
};
const showAppAlert = _createShowFn();

// Ícone por tipo
const _alertIconName = (type) => {
  if (type === 'error') return 'alert-circle';
  if (type === 'success') return 'check-circle';
  if (type === 'warning') return 'alert-triangle';
  if (type === 'confirm') return 'help-circle';
  return 'info';
};
const _alertIconColor = (type, T) => {
  if (type === 'error') return T?.red || '#DC2626';
  if (type === 'success') return T?.green || '#16A34A';
  if (type === 'warning') return T?.amber || '#D97706';
  if (type === 'confirm') return T?.blue || '#3B5BFF';
  return T?.blue || '#3B5BFF';
};

class AppAlertManager extends React.Component {
  constructor(props) {
    super(props);
    this.state = { visible: false, queue: [], current: null };
    this.scaleAnim = new Animated.Value(0.85);
    this.opacAnim = new Animated.Value(0);
    this.backdropAnim = new Animated.Value(0);
    this.iconBounce = new Animated.Value(0);
  }
  componentDidMount() { AppAlertService._flush(this); }
  show(entry) {
    this.setState(prev => {
      const newQueue = [...prev.queue, entry];
      if (!prev.visible) {
        return { visible: true, current: newQueue[0], queue: newQueue.slice(1) };
      }
      return { queue: newQueue };
    }, () => {
      if (this.state.visible && this.state.current) this._animateIn();
    });
  }
  _animateIn() {
    this.scaleAnim.setValue(0.82);
    this.opacAnim.setValue(0);
    this.backdropAnim.setValue(0);
    this.iconBounce.setValue(0);
    Animated.parallel([
      Animated.timing(this.backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(this.scaleAnim, { toValue: 1, tension: 180, friction: 10, useNativeDriver: true }),
      Animated.timing(this.opacAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      Animated.sequence([
        Animated.timing(this.iconBounce, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(2.5)), useNativeDriver: true }),
      ]).start();
    });
  }
  _dismiss(cb) {
    Animated.parallel([
      Animated.timing(this.backdropAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(this.scaleAnim, { toValue: 0.88, duration: 160, useNativeDriver: true }),
      Animated.timing(this.opacAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      if (cb) cb();
      this.setState(prev => {
        if (prev.queue.length > 0) {
          return { current: prev.queue[0], queue: prev.queue.slice(1), visible: true };
        }
        return { visible: false, current: null };
      }, () => {
        if (this.state.visible && this.state.current) this._animateIn();
      });
    });
  }
  render() {
    const { visible, current } = this.state;
    const T = this.props.T || THEMES.light;
    if (!current) return null;
    const type = current.type || 'info';
    const iconName = _alertIconName(type);
    const iconColor = _alertIconColor(type, T);
    const iconBg = iconColor + '18';
    const buttons = current.buttons || [{ text: 'OK' }];
    const isDestructive = buttons.some(b => b.style === 'destructive');
    const iconScale = this.iconBounce.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
    const iconOpac = this.iconBounce.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] });
    return (
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => {
        const cancelBtn = buttons.find(b => b.style === 'cancel');
        this._dismiss(() => cancelBtn?.onPress?.());
      }}>
        <Animated.View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'center', alignItems: 'center',
          paddingHorizontal: 28,
          opacity: this.backdropAnim,
        }}>
          <TouchableOpacity style={{ ...StyleSheet.absoluteFillObject }} activeOpacity={1}
            onPress={() => {
              const cancelBtn = buttons.find(b => b.style === 'cancel');
              if (cancelBtn) this._dismiss(() => cancelBtn.onPress?.());
            }}
          />
          <Animated.View style={{
            width: '100%', backgroundColor: T.bgCard,
            borderRadius: 28, overflow: 'hidden',
            borderWidth: 1.5, borderColor: iconColor + '30',
            shadowColor: iconColor, shadowOpacity: 0.22, shadowRadius: 28, elevation: 24,
            transform: [{ scale: this.scaleAnim }],
            opacity: this.opacAnim,
          }}>
            {/* Topo colorido */}
            <View style={{ height: 5, backgroundColor: iconColor, width: '100%' }} />
            <View style={{ padding: 28, alignItems: 'center' }}>
              {/* Ícone animado */}
              <Animated.View style={{
                width: 68, height: 68, borderRadius: 34,
                backgroundColor: iconBg, justifyContent: 'center', alignItems: 'center',
                marginBottom: 18,
                borderWidth: 2, borderColor: iconColor + '40',
                transform: [{ scale: iconScale }],
                opacity: iconOpac,
              }}>
                <Feather name={iconName} size={34} color={iconColor} />
              </Animated.View>
              {/* Título */}
              {!!current.title && (
                <Text style={{
                  fontSize: 18, fontWeight: '900', color: T.text,
                  textAlign: 'center', marginBottom: 10, lineHeight: 24,
                }}>
                  {current.title}
                </Text>
              )}
              {/* Mensagem */}
              {!!current.message && (
                <Text style={{
                  fontSize: 14.5, fontWeight: '500', color: T.textSub,
                  textAlign: 'center', lineHeight: 22,
                }}>
                  {current.message}
                </Text>
              )}
            </View>
            {/* Divisor */}
            <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 0 }} />
            {/* Botões */}
            <View style={{
              flexDirection: buttons.length === 1 ? 'column' : 'row',
              padding: buttons.length === 1 ? 16 : 0,
              gap: buttons.length === 1 ? 0 : 0,
            }}>
              {buttons.map((btn, idx) => {
                const isCancel = btn.style === 'cancel';
                const isDestr = btn.style === 'destructive';
                const isLast = idx === buttons.length - 1;
                const btnColor = isDestr ? T.red : isCancel ? T.textSub : iconColor;
                return (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.7}
                    onPress={() => this._dismiss(() => btn.onPress?.())}
                    style={{
                      flex: buttons.length > 1 ? 1 : undefined,
                      paddingVertical: 16,
                      paddingHorizontal: 12,
                      alignItems: 'center', justifyContent: 'center',
                      borderRightWidth: buttons.length > 1 && !isLast ? 1 : 0,
                      borderColor: T.border,
                      backgroundColor: isDestr ? T.red + '10' : isCancel ? 'transparent' : iconColor + '08',
                      borderBottomLeftRadius: buttons.length === 1 ? 0 : idx === 0 ? 26 : 0,
                      borderBottomRightRadius: buttons.length === 1 ? 0 : isLast ? 26 : 0,
                      marginBottom: buttons.length === 1 ? 0 : 0,
                    }}
                  >
                    <Text style={{
                      fontSize: 15, fontWeight: isDestr || (!isCancel) ? '800' : '600',
                      color: btnColor,
                      letterSpacing: 0.2,
                    }}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    );
  }
}

// Ref global para o AppAlertManager montado no App
let _appAlertManagerRef = null;
const setAppAlertManagerRef = (ref) => { _appAlertManagerRef = ref; };

// Função global substituta de Alert.alert
const AppAlert = {
  alert: (title, message, buttons, opts) => {
    // Detecta tipo automaticamente pelo título
    let type = opts?.type || 'info';
    const titleStr = (title || '').toLowerCase();
    if (/erro|falha|inválid|incorret|negad/.test(titleStr)) type = 'error';
    else if (/sucesso|realizado|ativad|alterada|removid/.test(titleStr)) type = 'success';
    else if (/atenção|aviso|já exist|bloqueada|necessária|inválido|similar/.test(titleStr)) type = 'warning';
    else if (/apagar|deletar|cancelar|remover|confirm/.test(titleStr)) type = 'confirm';
    AppAlertService.show({
      title, message,
      buttons: buttons || [{ text: 'OK' }],
      type,
    });
  },
};

const WIN = Dimensions.get('window');
const SCR = Dimensions.get('screen');
const NAV_BAR_H = Platform.OS === 'android' ? Math.max(0, SCR.height - WIN.height) : 0;
const W = WIN.width;

// ─── SEGURANÇA ──────────────────────────────────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECS = 60;
const INPUT_SANITIZE_REGEX = /[<>'"]/g;
const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|--|\bOR\b|\bAND\b)\b)/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ─── API SEGURA PARA TOKENS ─────────────────────────────────────────────────
const TOKEN_API_URL = 'https://gei-ai-eta.vercel.app/api/estoque';
const TOKEN_API_KEY = 'cordeirorequestloja3';
let BASEROW_TOKEN = '';
let RT_API_KEY_IA = 'AIzaSyDQ37jwNASoO_6eHZpvI4pQtD7Ix0OX8Qc'; // fallback key
let RT_BLUESOFT_TOKEN = 'Py8pbK4V5YwLGB09ECMJrA'; // fallback token Bluesoft Cosmos
let GROQ_API_KEY = '';
let ELEVEN_LABS_API_KEY_SECONDARY = '';

// ─── LOGS DE AUDITORIA ─────────────────────────────────────────────────────
const AUDIT_LOGS_KEY = 'GEI_AuditLogs';
const MAX_AUDIT_LOGS = 1000;
const addAuditLog = async (action, details, userId = null) => {
  try {
    const log = {
      id: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${Date.now()}-${action}-${Math.random()}`),
      timestamp: new Date().toISOString(),
      action,
      details,
      userId,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || '1.0.0'
    };
    const existingLogs = await getAuditLogs();
    const updatedLogs = [log, ...existingLogs].slice(0, MAX_AUDIT_LOGS);
    await SafeStore.setItemAsync(AUDIT_LOGS_KEY, JSON.stringify(updatedLogs));
    return true;
  } catch (error) {
    console.error('Erro ao salvar log:', error);
    return false;
  }
};
const getAuditLogs = async () => {
  try {
    const logs = await SafeStore.getItemAsync(AUDIT_LOGS_KEY);
    return logs ? JSON.parse(logs) : [];
  } catch { return []; }
};
const clearAuditLogs = async () => { await SafeStore.deleteItemAsync(AUDIT_LOGS_KEY); };

// ─── TOKENS ────────────────────────────────────────────────────────────────
let tokensFetched = false;
let tokensFetching = false;
let tokensCallbacks = [];
  const fetchSecureTokens = () => new Promise((resolve, reject) => {
    if (tokensFetched && BASEROW_TOKEN && RT_API_KEY_IA && RT_BLUESOFT_TOKEN && GROQ_API_KEY) {
      resolve();
      return;
    }
    tokensCallbacks.push({ resolve, reject });
    if (tokensFetching) return;
    tokensFetching = true;
    fetch(TOKEN_API_URL, {
      method: 'GET',
      headers: { 'x-api-key': TOKEN_API_KEY, 'Content-Type': 'application/json' }
    })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Acesso negado: chave da API inválida ou expirada.');
        if (!response.ok) throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();
        if (!data.BASEROW_TOKEN || !data.API_KEY_IA || !data.API_KEY_GROQ) {
          throw new Error('Resposta da API não contém todos os tokens necessários.');
        }
        BASEROW_TOKEN = data.BASEROW_TOKEN;
        RT_API_KEY_IA = data.API_KEY_IA;
        // Bluesoft: usa o do servidor se vier, senao mantém o fallback hardcoded
        RT_BLUESOFT_TOKEN = data.BLUESOFT_TOKEN || RT_BLUESOFT_TOKEN || 'Py8pbK4V5YwLGB09ECMJrA';
        GROQ_API_KEY = data.API_KEY_GROQ;
        
        // Tenta buscar API secundária ElevenLabs do Baserow (Tabela 915031)
        try {
          const resB = await fetch(`https://api.baserow.io/api/database/rows/table/915031/?user_field_names=true&size=1`, {
            headers: { 'Authorization': `Token ${BASEROW_TOKEN}` }
          });
          if (resB.ok) {
            const dB = await resB.json();
            if (dB.results && dB.results[0] && dB.results[0].API_ELEVENLABS1) {
              ELEVEN_LABS_API_KEY_SECONDARY = dB.results[0].API_ELEVENLABS1;
              await SafeStore.setItemAsync('ELEVEN_LABS_API_KEY_SECONDARY', ELEVEN_LABS_API_KEY_SECONDARY);
              console.log('✅ API Secundária ElevenLabs carregada do Baserow');
            } else {
              console.warn('[ElevenLabs] Campo API_ELEVENLABS1 não encontrado na tabela 915031 do Baserow. Verifique se o campo existe e tem valor.');
            }
          } else {
            console.error(`[ElevenLabs] Baserow retornou status ${resB.status} ao buscar chave secundária.`);
          }
        } catch (errB) { console.warn('Falha ao buscar API secundária no Baserow:', errB.message); }

        await SafeStore.setItemAsync('BASEROW_TOKEN', BASEROW_TOKEN);
        await SafeStore.setItemAsync('API_KEY_IA', RT_API_KEY_IA);
        await SafeStore.setItemAsync('BLUESOFT_TOKEN', RT_BLUESOFT_TOKEN);
        await SafeStore.setItemAsync('GROQ_API_KEY', GROQ_API_KEY);
        tokensFetched = true;
        tokensFetching = false;
        tokensCallbacks.forEach(cb => cb.resolve());
        tokensCallbacks = [];
        await addAuditLog('TOKENS_FETCHED', 'Tokens obtidos com sucesso da API segura');
      })
    .catch(err => {
      console.error('Erro ao buscar tokens da API segura:', err);
      tokensFetching = false;
      tokensCallbacks.forEach(cb => cb.reject(err));
      tokensCallbacks = [];
    });
});
const initializeSecureTokens = async () => {
  try {
    const cachedBaserow = await SafeStore.getItemAsync('BASEROW_TOKEN');
    const cachedApiIa = await SafeStore.getItemAsync('API_KEY_IA');
    const cachedBluesoft = await SafeStore.getItemAsync('BLUESOFT_TOKEN');
    const cachedGroq = await SafeStore.getItemAsync('GROQ_API_KEY');
    if (cachedBaserow && cachedApiIa && cachedBluesoft && cachedGroq) {
      BASEROW_TOKEN = cachedBaserow;
      RT_API_KEY_IA = cachedApiIa;
      RT_BLUESOFT_TOKEN = cachedBluesoft;
      ELEVEN_LABS_API_KEY_SECONDARY = await SafeStore.getItemAsync('ELEVEN_LABS_API_KEY_SECONDARY') || '';
      GROQ_API_KEY = cachedGroq;
      tokensFetched = true;
      return true;
    }
    await fetchSecureTokens();
    return true;
  } catch (error) {
    console.error('Falha na inicialização dos tokens:', error);
    return false;
  }
};

// ─── AXIOS ─────────────────────────────────────────────────────────────────
const secureAxiosInstance = axios.create({ timeout: 8000, headers: { 'Content-Type': 'application/json' } });
secureAxiosInstance.interceptors.request.use(async (config) => {
  if (!BASEROW_TOKEN) await initializeSecureTokens();
  config.headers.Authorization = `Token ${BASEROW_TOKEN}`;
  return config;
});

// ─── PERMISSÃO DE MICROFONE (nível de módulo — acessível em todos os componentes) ──
const requestMicPermission = async () => {
  // Web: requestPermissionsAsync não é suportado — permissão concedida implicitamente
  // pelo navegador quando o getUserMedia for chamado pela primeira vez.
  if (Platform.OS === 'web') return true;
  if (!SPEECH_RECOGNITION_AVAILABLE) {
    console.warn('⚠️ Reconhecimento de voz não disponível neste ambiente.');
    return false;
  }
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  } catch (err) {
    console.error('❌ ERRO ao solicitar permissões:', err);
    return false;
  }
};

// ─── BIOMETRIA ─────────────────────────────────────────────────────────────
const checkBiometricSupport = async () => {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return { isAvailable: hasHardware && isEnrolled, hasHardware, isEnrolled, types: supportedTypes };
};
const authenticateWithBiometrics = async (reason = 'Autentique-se para acessar o GEI.AI') => {
  try {
    const { isAvailable } = await checkBiometricSupport();
    if (!isAvailable) return { success: false, error: 'Biometria não disponível' };
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Usar senha',
      disableDeviceFallback: false,
    });
    if (result.success) await addAuditLog('BIOMETRIC_AUTH_SUCCESS', 'Autenticação biométrica bem-sucedida');
    else await addAuditLog('BIOMETRIC_AUTH_FAILED', `Falha: ${result.error}`);
    return { success: result.success, error: result.error };
  } catch (error) {
    await addAuditLog('BIOMETRIC_AUTH_ERROR', error.message);
    return { success: false, error: error.message };
  }
};

// ─── SANITIZAÇÃO ───────────────────────────────────────────────────────────
const sanitizeInput = (input) => {
  if (!input) return '';
  let sanitized = String(input);
  sanitized = sanitized.replace(INPUT_SANITIZE_REGEX, '');
  sanitized = sanitized.replace(SQL_INJECTION_PATTERN, '');
  sanitized = sanitized.trim();
  sanitized = sanitized.slice(0, 200);
  return sanitized;
};
const isValidEmail = (email) => { if (!email) return false; return EMAIL_REGEX.test(email); };

// ─── SHELVES ───────────────────────────────────────────────────────────────
const SHELVES = {
  bebida: '150731', macarrao: '656122', pesado: '656123',
  frios: '656124', biscoito: '656126',
};
const SHELF_KEYS = Object.keys(SHELVES);
const SHELF_LABEL = {
  bebida: 'Bebidas', macarrao: 'Macarrão/Leite', pesado: 'Pesado',
  frios: 'Frios', biscoito: 'Biscoito',
};
const SHELF_ALIAS = {
  bebida: 'bebida', bebidas: 'bebida', macarrao: 'macarrao', 'macarrão': 'macarrao',
  mercearia: 'macarrao', 'mercearia/graos': 'macarrao', 'mercearia/grãos': 'macarrao',
  graos: 'macarrao', 'grãos': 'macarrao', 'macarrao/leite': 'macarrao', 'macarrão/leite': 'macarrao',
  pesado: 'pesado', frios: 'frios', frio: 'frios', biscoito: 'biscoito', biscoitos: 'biscoito',
};
const AREA_PERFIS = ['deposito', 'coordenador', 'repositor'];
const ALL_ROLES = ['Repositor', 'Deposito', 'Coordenador'];

// ─── TEMAS — REDESENHADOS (paleta "Aurora") ────────────────────────────────
// Nova identidade visual: violeta+âmbar (antes era azul puro), fundos com
// leve tingimento de cor, bordas mais suaves, mais contraste tipográfico.
// Todas as chaves originais foram preservadas para não quebrar nenhum
// componente que consome T.*, e foi adicionado um 4º tema (sunset).
const THEMES = {
  light: {
    name: 'Claro', icon: 'sun',
    bg: '#F7F6FB', bgCard: '#FFFFFF', bgElevated: '#F0EDFB', bgInput: '#F3F1FA',
    blue: '#6D4AFF', blueMid: 'rgba(109,74,255,0.14)', blueGlow: 'rgba(109,74,255,0.08)',
    teal: '#0D9488', tealGlow: 'rgba(13,148,136,0.08)',
    purple: '#9333EA', purpleGlow: 'rgba(147,51,234,0.08)',
    orange: '#F59E0B', orangeGlow: 'rgba(245,158,11,0.1)',
    green: '#16A34A', greenSolid: '#15803D', greenGlow: 'rgba(22,163,74,0.1)',
    red: '#E11D48', redSolid: '#BE123C', redGlow: 'rgba(225,29,72,0.08)',
    amber: '#D97706', amberSolid: '#B45309', amberGlow: 'rgba(217,119,6,0.1)',
    text: '#161324', textSub: '#665E80', textMuted: '#A39CBD',
    border: 'rgba(109,74,255,0.10)', borderMid: 'rgba(109,74,255,0.20)',
    accent: '#6D4AFF', accentSoft: '#F59E0B',
  },
  dark: {
    name: 'Escuro', icon: 'moon',
    bg: '#0A0814', bgCard: '#14101F', bgElevated: '#1C1530', bgInput: '#1A1428',
    blue: '#8B6CFF', blueMid: 'rgba(139,108,255,0.22)', blueGlow: 'rgba(139,108,255,0.13)',
    teal: '#2DD4BF', tealGlow: 'rgba(45,212,191,0.13)',
    purple: '#A78BFA', purpleGlow: 'rgba(167,139,250,0.13)',
    orange: '#FBBF24', orangeGlow: 'rgba(251,191,36,0.13)',
    green: '#34D399', greenSolid: '#16A34A', greenGlow: 'rgba(52,211,153,0.13)',
    red: '#FB7185', redSolid: '#E11D48', redGlow: 'rgba(251,113,133,0.13)',
    amber: '#FCD34D', amberSolid: '#D97706', amberGlow: 'rgba(252,211,77,0.13)',
    text: '#F5F2FF', textSub: '#9B8FC2', textMuted: '#4A4066',
    border: 'rgba(139,108,255,0.12)', borderMid: 'rgba(139,108,255,0.22)',
    accent: '#8B6CFF', accentSoft: '#FBBF24',
  },
  ocean: {
    name: 'Oceano', icon: 'droplet',
    bg: '#05111C', bgCard: '#0B1E2E', bgElevated: '#102A3D', bgInput: '#0E2336',
    blue: '#22D3EE', blueMid: 'rgba(34,211,238,0.2)', blueGlow: 'rgba(34,211,238,0.1)',
    teal: '#2DD4BF', tealGlow: 'rgba(45,212,191,0.1)',
    purple: '#67E8F9', purpleGlow: 'rgba(103,232,249,0.1)',
    orange: '#FB923C', orangeGlow: 'rgba(251,146,60,0.1)',
    green: '#34D399', greenSolid: '#059669', greenGlow: 'rgba(52,211,153,0.1)',
    red: '#FB7185', redSolid: '#E11D48', redGlow: 'rgba(251,113,133,0.1)',
    amber: '#FDE68A', amberSolid: '#D97706', amberGlow: 'rgba(253,230,138,0.1)',
    text: '#E5F8FC', textSub: '#5FA3BD', textMuted: '#123349',
    border: 'rgba(34,211,238,0.1)', borderMid: 'rgba(34,211,238,0.18)',
    accent: '#22D3EE', accentSoft: '#FB923C',
  },
  sunset: {
    name: 'Pôr do Sol', icon: 'sunset',
    bg: '#1A0F0A', bgCard: '#241510', bgElevated: '#301C13', bgInput: '#2A1810',
    blue: '#FB7185', blueMid: 'rgba(251,113,133,0.2)', blueGlow: 'rgba(251,113,133,0.12)',
    teal: '#FBBF24', tealGlow: 'rgba(251,191,36,0.12)',
    purple: '#F472B6', purpleGlow: 'rgba(244,114,182,0.12)',
    orange: '#FB923C', orangeGlow: 'rgba(251,146,60,0.13)',
    green: '#A3E635', greenSolid: '#65A30D', greenGlow: 'rgba(163,230,53,0.12)',
    red: '#F87171', redSolid: '#DC2626', redGlow: 'rgba(248,113,113,0.13)',
    amber: '#FCD34D', amberSolid: '#D97706', amberGlow: 'rgba(252,211,77,0.13)',
    text: '#FFF3EA', textSub: '#C7958A', textMuted: '#5C3F38',
    border: 'rgba(251,146,60,0.14)', borderMid: 'rgba(251,146,60,0.22)',
    accent: '#FB923C', accentSoft: '#FB7185',
  },
};

const makeGiro = (theme) => ({
  'Grande giro': { color: theme.green, solid: theme.greenSolid, glow: theme.greenGlow, icon: 'trending-up', short: '↑ Grande', rate: 5.2 },
  'Médio giro': { color: theme.amber, solid: theme.amberSolid, glow: theme.amberGlow, icon: 'minus', short: '⟶ Médio', rate: 2.5 },
  'Pouco giro': { color: theme.red, solid: theme.redSolid, glow: theme.redGlow, icon: 'trending-down', short: '↓ Pouco', rate: 0.8 },
});

// ─── DATE UTILS ────────────────────────────────────────────────────────────
const parseDate = str => {
  if (!str?.trim()) return null;
  const [d, m, y] = String(str).trim().split('/');
  if (!d || !m || !y) return null;
  const dt = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
  return isNaN(dt.getTime()) ? null : dt;
};
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const diffDays = (a, b) => Math.floor((a - b) / 86400000);
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
const fmt = (dt, full = false) => {
  if (!(dt instanceof Date) || isNaN(dt)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', ...(full ? { year: 'numeric' } : {}) }).format(dt);
};
const fmtFull = dt => fmt(dt, true);
const vencStatus = str => {
  const dt = parseDate(str);
  if (!dt) return { status: 'unknown', days: null };
  const d = diffDays(dt, today());
  if (d < 0) return { status: 'expired', days: d };
  if (d <= 7) return { status: 'warning', days: d };
  if (d <= 30) return { status: 'warning30', days: d };
  return { status: 'ok', days: d };
};
const qtyToNumber = v => {
  const n = parseInt(String(v ?? '0').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const isValidDate = (dateStr) => {
  if (!dateStr || dateStr.length !== 10) return false;
  const [d, m, y] = dateStr.split('/').map(Number);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return false;
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return false;
  return true;
};

// ─── SMARTCORRECTDATE — Correção inteligente de data (fuzzy) ──────────────
// Recebe uma string DD/MM/AAAA (possivelmente errada) e devolve a versão
// mais plausível, aplicando heurísticas:
//   • Ano 20xx < 2020  → +10   (ex: 2016 → 2026, 2017 → 2027)
//   • Ano 19xx >= 2000 se +100 fica plausível → +100 (ex: 1926 → 2026)
//   • Mês > 12 e dia <= 12     → troca dia ↔ mês (DD/MM invertido)
//   • Dia > último dia do mês  → clamp ao último dia válido
//   • Resultado no passado distante (>60 dias atrás) → tenta +1 ano no ano
const smartCorrectDate = (dateStr) => {
  if (!dateStr) return dateStr;
  const curYear = new Date().getFullYear();
  const parts = String(dateStr).trim().split('/');
  if (parts.length !== 3) return dateStr;

  let d = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  let y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return dateStr;

  // ── 1. Corrigir ano ──────────────────────────────────────────────────────
  // 2 dígitos (ex: 26 → 2026)
  if (y >= 0 && y <= 99) y = 2000 + y;
  // 4 dígitos mas pré-2020: reconhecedor de voz ouviu "dezesseis" = 2016 → 2026
  if (y >= 2000 && y < 2020) y = y + 10;
  // 19xx que somado 100 dá 20xx plausível (ex: 1926 → 2026)
  if (y >= 1920 && y < 2000) {
    const candidate = y + 100;
    if (candidate >= curYear && candidate <= curYear + 15) y = candidate;
    else y = curYear; // fallback ao ano atual se ainda inválido
  }
  // Ano > 2099 ou < 2020: força ano atual
  if (y < 2020 || y > 2099) y = curYear;

  // ── 2. Corrigir mês/dia invertidos ───────────────────────────────────────
  // Se mês > 12 mas dia <= 12: claramente invertido
  if (m > 12 && d >= 1 && d <= 12) { const tmp = m; m = d; d = tmp; }
  // Se mês ainda > 12: não tem como corrigir, usa mês 1
  if (m < 1 || m > 12) m = 1;

  // ── 3. Clamp do dia ao último dia do mês ─────────────────────────────────
  const maxDay = new Date(y, m, 0).getDate();
  if (d < 1) d = 1;
  if (d > maxDay) d = maxDay;

  // ── 4. Se a data resultante é muito no passado (>= 365 dias atrás) ────────
  //    e o mesmo dia/mês no ano atual ou próximo ainda é futuro → corrige ano
  const resultDate = new Date(y, m - 1, d);
  const todayMs = new Date(); todayMs.setHours(0,0,0,0);
  const diffDaysResult = Math.floor((todayMs - resultDate) / 86400000);
  if (diffDaysResult >= 365) {
    // Tenta ano atual
    const candidateThis = new Date(curYear, m - 1, d);
    if (candidateThis >= todayMs) y = curYear;
    else y = curYear + 1; // se já passou este ano, usa próximo
  }

  // ── 5. PATCH: se o MES da validade ja venceu (ou e este mes), empurra
  //    para o proximo mes com dia valido — evita cadastrar produto ja vencido
  //    quando o usuario falou so "validade 15" e a IA assumiu o mes atual.
  {
    let finalDate = new Date(y, m - 1, d);
    let guard = 0;
    while (finalDate < todayMs && guard < 36) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      const maxD = new Date(y, m, 0).getDate();
      const dd = Math.min(d, maxD);
      finalDate = new Date(y, m - 1, dd);
      d = dd;
      guard += 1;
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d)}/${pad(m)}/${y}`;
};

// ─── HELPERS DE API ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(tid);
    return r;
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('Timeout: requisição demorou demais');
    throw e;
  }
};
const parseApiError = async (response) => {
  try {
    const body = await response.json();
    if (body?.error?.message) return body.error.message;
    if (body?.error?.error?.message) return body.error.error.message;
    if (body?.message) return body.message;
    return `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
};

// ==================== SISTEMA DE IA OTIMIZADO COM CACHE ====================
const AI_CACHE_KEY = 'GEI_AICache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const pendingRequests = new Map();
const getAICache = async () => {
  try {
    const raw = await SafeStore.getItemAsync(AI_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const setAICache = async (cache) => {
  try { await SafeStore.setItemAsync(AI_CACHE_KEY, JSON.stringify(cache)); } catch (e) { console.warn('Cache save error', e); }
};
const cleanExpiredCache = async () => {
  const cache = await getAICache();
  const now = Date.now();
  let changed = false;
  for (const [key, val] of Object.entries(cache)) {
    if (val.expiresAt && val.expiresAt < now) {
      delete cache[key];
      changed = true;
    }
  }
  if (changed) await setAICache(cache);
};
const callGeminiOptimized = async (prompt, useCache = true, cacheKey = null) => {
  if (!RT_API_KEY_IA) throw new Error('Chave Gemini indisponível');
  const finalCacheKey = cacheKey || `gemini_${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, prompt)}`;
  if (useCache) {
    const cache = await getAICache();
    if (cache[finalCacheKey] && cache[finalCacheKey].expiresAt > Date.now()) return cache[finalCacheKey].response;
  }
  if (pendingRequests.has(finalCacheKey)) return await pendingRequests.get(finalCacheKey);
  const requestPromise = (async () => {
    const cheapModels = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastError = null;
    for (const model of cheapModels) {
      try {
        const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${RT_API_KEY_IA}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 512 },
          }),
        }, 6000);
        if (!res.ok) {
          const err = await parseApiError(res);
          if (res.status === 429 || err.includes('quota')) continue;
          throw new Error(err);
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          if (useCache) {
            const cache = await getAICache();
            cache[finalCacheKey] = { response: text, expiresAt: Date.now() + CACHE_TTL_MS };
            await setAICache(cache);
          }
          return text;
        }
      } catch (e) { lastError = e; }
    }
    throw lastError || new Error('Gemini falhou');
  })();
  pendingRequests.set(finalCacheKey, requestPromise);
  try { return await requestPromise; } finally { pendingRequests.delete(finalCacheKey); }
};
const callGroqOptimized = async (prompt, systemPrompt = null, useCache = true) => {
  if (!GROQ_API_KEY) throw new Error('Chave Groq indisponível');
  const fullPrompt = systemPrompt ? systemPrompt + '\n' + prompt : prompt;
  const cacheKey = `groq_${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fullPrompt)}`;
  if (useCache) {
    const cache = await getAICache();
    if (cache[cacheKey] && cache[cacheKey].expiresAt > Date.now()) return cache[cacheKey].response;
  }
  if (pendingRequests.has(cacheKey)) return await pendingRequests.get(cacheKey);
  const requestPromise = (async () => {
    const cheapGroqModels = ['llama-3.1-8b-instant', 'gemma2-9b-it', 'llama3-70b-8192'];
    let lastError = null;
    for (const model of cheapGroqModels) {
      try {
        const messages = systemPrompt
          ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt }];
        const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: 0.05, max_tokens: 512 }),
        }, 6000);
        if (!res.ok) {
          const err = await parseApiError(res);
          if (res.status === 429 || err.includes('rate limit')) continue;
          throw new Error(err);
        }
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text) {
          if (useCache) {
            const cache = await getAICache();
            cache[cacheKey] = { response: text, expiresAt: Date.now() + CACHE_TTL_MS };
            await setAICache(cache);
          }
          return text;
        }
      } catch (e) { lastError = e; }
    }
    throw lastError || new Error('Groq falhou');
  })();
  pendingRequests.set(cacheKey, requestPromise);
  try { return await requestPromise; } finally { pendingRequests.delete(cacheKey); }
};
const callGEIOptimized = async (prompt, useCache = true) => {
  try { return await callGeminiOptimized(prompt, useCache); } catch (e) {
    console.warn('Gemini falhou, usando Groq fallback:', e.message);
    return await callGroqOptimized(prompt, null, useCache);
  }
};

// ─── OPENROUTER — IA EXTRA (modelos GRATUITOS) ─────────────────────────────
// Token hardcoded a pedido do usuario. Pesquisa apenas modelos *:free.
const OPENROUTER_TOKEN = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Lista priorizada de modelos free do OpenRouter (ordem = ordem de fallback).
const OPENROUTER_FREE_MODELS = [
  'deepseek/deepseek-chat-v3.1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'nvidia/llama-3.1-nemotron-70b-instruct:free',
];

const callOpenRouterOptimized = async (prompt, systemPrompt = null, useCache = true, opts = {}) => {
  const fullPrompt = (systemPrompt || '') + '\n' + prompt;
  const cacheKey = 'openrouter_' + (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fullPrompt));
  if (useCache) {
    const cached = await iaCache.get(cacheKey);
    if (cached) return cached;
  }
  const messages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  let lastError = null;
  for (const model of OPENROUTER_FREE_MODELS) {
    try {
      const res = await fetchWithTimeout(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + OPENROUTER_TOKEN,
          'HTTP-Referer': 'https://gei-app.lovable.app',
          'X-Title': 'GEI Estoque IA',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.max_tokens ?? 700,
        })
      }, 18000);
      if (!res.ok) {
        const t = await res.text().catch(()=>'');
        lastError = new Error('OpenRouter ' + model + ' ' + res.status + ': ' + t.slice(0,200));
        // 429 / 402 → tenta proximo modelo free
        if (res.status === 429 || res.status === 402 || res.status === 503) continue;
        // Outros erros tambem caem para o proximo
        continue;
      }
      const json = await res.json();
      const txt = json?.choices?.[0]?.message?.content;
      if (txt) {
        const out = String(txt).trim();
        if (useCache) await iaCache.set(cacheKey, out);
        return out;
      }
    } catch (e) {
      lastError = e;
      continue;
    }
  }
  throw lastError || new Error('Todos os modelos free do OpenRouter falharam');
};

// ─── IA INTELIGENTE DE CADASTRO ────────────────────────────────────────────
// Gera prompts "pensados" pela IA: ela pergunta marca/embalagem/EAN, verifica
// se o produto existe e enriquece com sugestoes do mercado.
const callSmartCadastroIA = async (userText, contexto = {}) => {
  const system = `Voce e a GEI.IA, especialista BRASILEIRA em produtos de supermercado.
Pense em VOZ ALTA, em etapas curtas, como se estivesse digitando prompts inteligentes para voce mesma.
Cada etapa = UMA frase de ate 90 caracteres, comecando com um emoji.
Use marcas reais do Brasil (Nestle, Sadia, Perdigao, Tirol, Italac, Piracanjuba, Coca-Cola, Ype, Bombril, etc).
Cheque consistencia: leite/refrigerante = ml ou L (NUNCA g/kg); arroz/feijao/acucar = kg ou g (NUNCA ml).
Se detectar incoerencia (ex: "leite 1kg" ou "arroz 1 litro") gere etapa "⚠️ Incoerencia: corrigindo para Xml/Xg".
Tente DEDUZIR um EAN-13 plausivel consultando seu conhecimento de Bluesoft Cosmos / OpenFoodFacts / GS1 Brasil.
Se nao tiver certeza do EAN, deixe ean:"" e precisaEAN:true e pergunte "Voce tem o codigo de barras?".

Etapas obrigatorias na ordem (gere 5 a 7 frases):
1. 🔍 Confirmando produto (nome + tipo) que entendi
2. 🏷️ Buscando marca/embalagem real no mercado BR
3. ⚖️ Validando gramatura/volume (ml,L,g,kg) — corrige se inconsistente
4. 🇧🇷 Tentando localizar EAN-13 brasileiro (prefixo 789/790)
5. 📦 Sugerindo categoria e giro (Grande/Medio/Pouco)
6. ❓ Pergunta para o usuario (EAN, marca ou validade) se faltar info
7. ✅ Resumo final pronto para cadastro

Responda APENAS JSON valido, sem markdown:
{"steps":["frase1","frase2",...],
 "produto":{"nome":"NOME COMPLETO COM MARCA E GRAMATURA","marca":"...","categoria":"...","gramatura":"500g|1L|...","unidade":"g|kg|ml|L","ean":"7891234567890 ou \"\"","precisaEAN":true,"giro":"Medio giro","validade":""},
 "incoerencias":["..."],
 "pergunta":"pergunta curta ou null",
 "promptInterno":"prompt que voce mesma usaria para refinar este produto"}`;
  const prompt = 'Pedido do usuario: "' + userText + '"\n' +
    'Data de hoje: ' + new Date().toLocaleDateString('pt-BR') + '\n' +
    'Contexto:\n' + JSON.stringify(contexto || {}, null, 2);
  try { return await callOpenRouterOptimized(prompt, system, true, { temperature: 0.55, max_tokens: 1100 }); }
  catch (e1) {
    console.warn('[SmartCadastro] OpenRouter falhou:', e1.message);
    try { return await callGroqOptimized(prompt, system, true); }
    catch (e2) {
      console.warn('[SmartCadastro] Groq falhou:', e2.message);
      return await callGeminiOptimized(system + '\n' + prompt, true);
    }
  }
};

// PATCH: parser tolerante para JSON da SmartCadastro
const parseSmartCadastroJSON = (raw) => {
  if (!raw) return null;
  let s = String(raw).trim();
  // remove cercas markdown
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  // pega primeiro { ... } balanceado
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try { return JSON.parse(s); } catch { return null; }
};

const fetchIAWithConsensusOptimized = async (ean, nomeBase = "", categoriaBase = "") => {
  const cacheKey = `product_${ean}_${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nomeBase + categoriaBase)}`;
  const cache = await getAICache();
  if (cache[cacheKey] && cache[cacheKey].expiresAt > Date.now()) return cache[cacheKey].data;
  const prompt = `Você é GEI.IA, especialista em produtos de supermercado. Melhore o nome do produto abaixo, extraia marca, categoria, gramatura e rotatividade. Retorne APENAS JSON: {"nome":"...","marca":"...","categoria":"...","gramatura":"...","rotatividade":"Grande giro"|"Médio giro"|"Pouco giro","confianca":95}
Dados: Nome: ${nomeBase}, Categoria: ${categoriaBase}, EAN: ${ean}`;
  try {
    const resposta = await callGEIOptimized(prompt, true);
    const clean = resposta.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON inválido');
    const parsed = JSON.parse(match[0]);
    if (!parsed.nome || parsed.confianca < 50) throw new Error('Baixa confiança');
    const cacheData = { data: parsed, expiresAt: Date.now() + CACHE_TTL_MS };
    const newCache = await getAICache();
    newCache[cacheKey] = cacheData;
    await setAICache(newCache);
    return parsed;
  } catch (e) {
    console.warn('Consenso IA falhou:', e);
    return null;
  }
};
const fetchProductSourcesOptimized = async (ean) => {
  const fetchBluesoftCached = async () => {
    const cacheKey = `bluesoft_${ean}`;
    const cache = await getAICache();
    if (cache[cacheKey] && cache[cacheKey].expiresAt > Date.now()) return cache[cacheKey].data;
    try {
      const bluToken = RT_BLUESOFT_TOKEN || 'Py8pbK4V5YwLGB09ECMJrA';
      const res = await fetchWithTimeout(`https://api.cosmos.bluesoft.com.br/gtins/${ean}.json`, {
        headers: { 'X-Cosmos-Token': bluToken, 'Content-Type': 'application/json' }
      }, 6000);
      if (res.status === 401 || res.status === 403) throw new Error('Token Bluesoft invalido ou sem permissao');
      if (res.status === 404) throw new Error('EAN nao encontrado na base Bluesoft');
      if (!res.ok) throw new Error(`Bluesoft HTTP ${res.status}`);
      const d = await res.json();
      const nomeParts = [d.description, d.brand?.name].filter(Boolean);
      const peso = d.net_weight ? ` (${d.net_weight}${d.net_weight_unit || 'g'})` : '';
      const nome = (nomeParts.join(' · ') + peso).toUpperCase();
      const data = { status: 'success', source: 'bluesoft', sourceLabel: 'Bluesoft Cosmos', sourceIcon: 'database', nome: nome.trim() || 'PRODUTO SEM NOME', giro: 'Médio giro', categoria: d.ncm?.description || d.category?.description || '', confianca: 95 };
      const newCache = await getAICache();
      newCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      await setAICache(newCache);
      return data;
    } catch (e) { console.warn('[Bluesoft]', e.message); return { status: 'error', source: 'bluesoft', sourceLabel: 'Bluesoft Cosmos', error: e.message || 'Falha na consulta' }; }
  };
  const fetchOFFCached = async () => {
    const cacheKey = `off_${ean}`;
    const cache = await getAICache();
    if (cache[cacheKey] && cache[cacheKey].expiresAt > Date.now()) return cache[cacheKey].data;
    const tryOFF = async (baseUrl) => {
      const res = await fetchWithTimeout(`${baseUrl}/api/v0/product/${ean}.json`, {}, 5000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.status !== 1 || !d.product) throw new Error('Not found');
      return d.product;
    };
    try {
      let p = null;
      try { p = await tryOFF('https://br.openfoodfacts.org'); } catch { p = await tryOFF('https://world.openfoodfacts.org'); }
      const nomePt = (p.product_name_pt || p.product_name_pt_BR || p.product_name || '').toUpperCase().trim();
      const nomeCompleto = ([nomePt, p.brands].filter(Boolean).join(' · ') + (p.quantity ? ` (${p.quantity})` : '')).toUpperCase();
      if (!nomeCompleto.trim()) throw new Error('Nome vazio');
      const data = { status: 'success', source: 'openfoodfacts', sourceLabel: 'Open Food Facts', sourceIcon: 'globe', nome: nomeCompleto.trim(), giro: 'Médio giro', categoria: p.categories_tags?.[0]?.replace('en:', '') || p.categories || '', confianca: 92 };
      const newCache = await getAICache();
      newCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      await setAICache(newCache);
      return data;
    } catch (e) { return { status: 'error', source: 'openfoodfacts', sourceLabel: 'Open Food Facts', error: e.message || 'Não encontrado' }; }
  };
  const [bluesoft, off] = await Promise.all([fetchBluesoftCached(), fetchOFFCached()]);
  const melhorBase = off.status === 'success' ? off : (bluesoft.status === 'success' ? bluesoft : null);
  let iaResult = { status: 'error', source: 'ia', sourceLabel: 'GEI.IA (Gemini)', error: 'Sem dados base' };
  try {
    const baseNome = melhorBase?.nome || '';
    const baseCat = melhorBase?.categoria || '';
    const iaParsed = await fetchIAWithConsensusOptimized(ean, baseNome, baseCat);
    if (iaParsed && iaParsed.nome) {
      iaResult = {
        status: 'success', source: 'ia', sourceLabel: 'GEI.IA (Gemini)', sourceIcon: 'cpu',
        nome: ([iaParsed.nome, iaParsed.marca].filter(Boolean).join(' · ') + (iaParsed.gramatura ? ` (${iaParsed.gramatura})` : '')).toUpperCase(),
        giro: iaParsed.rotatividade || 'Médio giro', categoria: iaParsed.categoria || '', confianca: melhorBase ? 99 : 80
      };
    }
  } catch (e) { iaResult.error = e.message || 'Gemini falhou'; }
  const successSources = [iaResult, bluesoft, off].filter(r => r.status === 'success');
  if (successSources.length === 0) return [];
  return [iaResult, bluesoft, off].map(r => r.status === 'success' ? r : { ...r, nome: 'Falha: ' + (r.error || 'Erro'), confianca: 0 }).filter(r => r.status === 'success');
};
const fetchProductSources = fetchProductSourcesOptimized;
const callGEI = callGEIOptimized;
const fetchIAWithConsensus = fetchIAWithConsensusOptimized;

// ─── SIMILARIDADE ──────────────────────────────────────────────────────────
const stringSimilarity = (a, b) => {
  if (!a || !b) return 0;
  const tokenize = s => new Set(s.toLowerCase().replace(/[^a-z0-9çãõáéíóúâêîôû\s]/g, '').split(/\s+/).filter(Boolean));
  const sa = tokenize(a), sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  sa.forEach(t => { if (sb.has(t)) inter++; });
  return inter / (sa.size + sb.size - inter);
};
const normalizeName = (nome) => {
  if (!nome) return '';
  return nome.toLowerCase().replace(/[^a-z0-9çãõáéíóúâêîôû\s]/g, ' ').replace(/\s+/g, ' ').trim();
};
const extractBrand = (nome) => {
  if (!nome) return '';
  const parts = nome.split(/[\s·]+/);
  return parts[parts.length > 1 ? 1 : 0]?.toLowerCase() || '';
};

// ─── CAPS LOCK ─────────────────────────────────────────────────────────────
const CapsLockDetector = ({ children, onCapsLockChange }) => {
  const [isCapsLock, setIsCapsLock] = useState(false);
  const inputRef = useRef(null);
  const checkCapsLock = (event) => {
    if (event.nativeEvent && typeof event.nativeEvent.key !== 'undefined') {
      const key = event.nativeEvent.key;
      if (key && key.length === 1) {
        const isUpperCase = key === key.toUpperCase() && key !== key.toLowerCase();
        const hasShift = event.nativeEvent.shiftKey;
        const capsLockActive = isUpperCase && !hasShift;
        setIsCapsLock(capsLockActive);
        onCapsLockChange?.(capsLockActive);
      }
    }
  };
  return children({ ref: inputRef, onKeyPress: checkCapsLock, isCapsLock });
};

// ─── QR CODE ───────────────────────────────────────────────────────────────
const QrCodeGenerator = ({ T, fontScale, userData, onClose }) => {
  const [qrValue, setQrValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [loginRapido, setLoginRapido] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  useEffect(() => { generateLoginQR(); }, [generateLoginQR]);
  const generateLoginQR = useCallback(async () => {
    setLoading(true);
    try {
      const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`);
      const user = res.data.results.find(u => u.USUARIO === userData?.USUARIO);
      if (!user) { AppAlert.alert('Erro', 'Não foi possível encontrar seus dados de acesso.'); setLoading(false); return; }
      const loginRapidoValue = user.LOGINRAPIDO || '';
      if (!loginRapidoValue) { AppAlert.alert('Aviso', 'Seu usuário não possui LOGINRAPIDO configurado. Contate o administrador.'); setLoading(false); return; }
      setLoginRapido(loginRapidoValue);
      const payload = {
        usuario: userData.USUARIO,
        loginRapido: loginRapidoValue,
        perfil: userData.PERFIL,
        nome: userData.NOME,
        timestamp: Date.now(),
        expiraEm: Date.now() + (24 * 60 * 60 * 1000),
      };
      const qrString = JSON.stringify(payload);
      setQrValue(qrString);
      setExpiresAt(new Date(payload.expiraEm));
      await SafeStore.setItemAsync('last_qr_data', qrString);
      await addAuditLog('QR_GENERATED', `QR Code gerado para ${userData.USUARIO}`, userData.id);
    } catch (error) { console.error('Erro ao gerar QR:', error); AppAlert.alert('Erro', 'Falha ao gerar QR Code de acesso.'); } finally { setLoading(false); }
  }, [userData]);
  const copyToClipboard = async () => { if (qrValue) { await Clipboard.setStringAsync(qrValue); setCopied(true); setTimeout(() => setCopied(false), 2000); } };
  if (loading) return (<View style={{ alignItems: 'center', justifyContent: 'center', padding: 40 }}><ActivityIndicator size="large" color={T.blue} /><Text style={{ marginTop: 16, color: T.textSub }}>Gerando QR Code de acesso...</Text></View>);
  if (!loginRapido) return (<View style={{ alignItems: 'center', justifyContent: 'center', padding: 40 }}><View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: T.amberGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="alert-circle" size={30} color={T.amber} /></View><Text style={{ marginTop: 20, fontSize: 16, fontWeight: '700', color: T.text, textAlign: 'center' }}>LOGINRAPIDO não configurado</Text><Text style={{ marginTop: 8, fontSize: 13, color: T.textSub, textAlign: 'center' }}>Contate o administrador para configurar o campo LOGINRAPIDO no seu perfil.</Text></View>);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}><Feather name="shield" size={36} color={T.blue} /></View>
        <Text style={{ fontSize: 20 * fontScale, fontWeight: '900', color: T.text, textAlign: 'center' }}>QR Code de Acesso Rápido</Text>
        <Text style={{ fontSize: 13 * fontScale, color: T.textSub, textAlign: 'center', marginTop: 4 }}>Escaneie para fazer login em outro dispositivo</Text>
      </View>
      <View style={{ backgroundColor: '#FFF', padding: 20, borderRadius: 24, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 10, marginBottom: 20 }}>{qrValue ? <QRCode value={qrValue} size={240} color="#000" backgroundColor="#FFF" /> : null}</View>
      <View style={{ width: '100%', backgroundColor: T.bgElevated, borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={{ fontSize: 12, fontWeight: '700', color: T.textMuted }}>Login Rápido:</Text><Text style={{ fontSize: 12, fontWeight: '800', color: T.blue }}>{loginRapido}</Text></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={{ fontSize: 12, fontWeight: '700', color: T.textMuted }}>Expira em:</Text><Text style={{ fontSize: 12, fontWeight: '600', color: expiresAt && expiresAt < new Date() ? T.red : T.green }}>{expiresAt ? expiresAt.toLocaleString() : '—'}</Text></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 12, fontWeight: '700', color: T.textMuted }}>Válido por:</Text><Text style={{ fontSize: 12, fontWeight: '600', color: T.textSub }}>24 horas</Text></View>
      </View>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.bgInput, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginBottom: 16 }} onPress={copyToClipboard}><Feather name="copy" size={16} color={T.textSub} /><Text style={{ fontSize: 13, fontWeight: '600', color: T.textSub }}>{copied ? 'Copiado!' : 'Copiar dados do QR'}</Text></TouchableOpacity>
      <TouchableOpacity style={{ width: '100%', backgroundColor: T.blue, paddingVertical: 14, borderRadius: 14, alignItems: 'center' }} onPress={onClose}><Text style={{ fontSize: 15, fontWeight: '800', color: '#FFF' }}>Fechar</Text></TouchableOpacity>
    </ScrollView>
  );
};

// ─── DARK TORCH PROMPT ─────────────────────────────────────────────────────
const DarkTorchPrompt = ({ isDarkEnv, lightLevel, torchOn, onToggleTorch, T, fontScale }) => {
  const slideA = useRef(new Animated.Value(140)).current;
  const pulseA = useRef(new Animated.Value(1)).current;
  const [dismissed, setDismissed] = useState(false);
  const darkPct = Math.round((1 - lightLevel) * 100);
  useEffect(() => {
    if (isDarkEnv && !torchOn && !dismissed) {
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 70, friction: 10, useNativeDriver: false }),
        Animated.loop(Animated.sequence([Animated.timing(pulseA, { toValue: 1.22, duration: 720, useNativeDriver: false }), Animated.timing(pulseA, { toValue: 1, duration: 720, useNativeDriver: false })]))
      ]).start();
    } else { Animated.timing(slideA, { toValue: 140, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(); }
  }, [isDarkEnv, torchOn, dismissed, slideA, pulseA]);
  if (!isDarkEnv || torchOn || dismissed) return null;
  return (
    <Animated.View style={{ position: 'absolute', bottom: 160, left: 20, right: 20, backgroundColor: T.bgCard, borderRadius: 28, padding: 22, borderWidth: 2.5, borderColor: T.orange + '75', shadowColor: T.orange, shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.5, shadowRadius: 32, elevation: 32, transform: [{ translateY: slideA }], zIndex: 10000 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Animated.View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: T.orange + '22', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: T.orange + '45', transform: [{ scale: pulseA }] }}><Feather name="zap" size={34} color={T.orange} /></Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5 * fontScale, fontWeight: '900', color: T.orange, textTransform: 'uppercase', letterSpacing: 1.4 }}>🌙 Ambiente muito escuro</Text>
          <Text style={{ fontSize: 17.5 * fontScale, fontWeight: '900', color: T.text, lineHeight: 23, marginTop: 3 }}>Ligue a lanterna para ler melhor!</Text>
          <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', marginTop: 6 }}>Luminosidade: {darkPct}% de escuridão</Text>
        </View>
      </View>
      <View style={{ height: 7, backgroundColor: T.border, borderRadius: 999, marginTop: 18, overflow: 'hidden' }}><View style={{ height: '100%', width: `${Math.max(10, darkPct)}%`, backgroundColor: T.orange, borderRadius: 999 }} /></View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 22 }}>
        <TouchableOpacity onPress={onToggleTorch} style={{ flex: 1, height: 58, backgroundColor: T.orange, borderRadius: 18, justifyContent: 'center', alignItems: 'center', shadowColor: T.orange, shadowOpacity: 0.55, shadowRadius: 16, elevation: 14 }}><Text style={{ color: '#FFF', fontSize: 16.5 * fontScale, fontWeight: '900' }}>⚡ LIGAR LANTERNA</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setDismissed(true)} style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}><Feather name="x" size={26} color={T.textMuted} /></TouchableOpacity>
      </View>
    </Animated.View>
  );
};

// ─── AUTO-DELETE ENGINE ────────────────────────────────────────────────────
// Considera vencido qualquer produto cuja data de validade já passou (≥1 dia)
const isExpiredOver30 = vencimento => { const dt = parseDate(vencimento); if (!dt) return false; return diffDays(today(), dt) >= 1; };
const cleanShelf = async (shelfKey, tableId) => {
  const deleted = [];
  try {
    const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true&size=200`);
    const rows = res.data.results || [];
    const toDelete = rows.filter(r => isExpiredOver30(r.VENCIMENTO));
    await Promise.all(toDelete.map(async row => {
      try {
        await secureAxiosInstance.delete(`https://api.baserow.io/api/database/rows/table/${tableId}/${row.id}/`);
        deleted.push({ nome: String(row.produto || 'Produto').trim() || 'Produto sem nome', vencimento: row.VENCIMENTO, shelf: SHELF_LABEL[shelfKey] || shelfKey, dias: Math.abs(diffDays(today(), parseDate(row.VENCIMENTO))) });
      } catch (_) { /* noop */ }
    }));
  } catch (_) { /* noop */ }
  return deleted;
};
const runAutoClean = async () => { const results = await Promise.all(SHELF_KEYS.map(k => cleanShelf(k, SHELVES[k]))); return results.flat(); };

// ==================== SISTEMA FIFO PARA MÚLTIPLOS LOTES ====================
const groupProductsByEAN = (products) => {
  const groups = new Map();
  for (const prod of products) {
    const ean = prod.codig || 'Sem EAN';
    if (!groups.has(ean)) groups.set(ean, []);
    groups.get(ean).push(prod);
  }
  for (const [ean, lotes] of groups.entries()) {
    lotes.sort((a, b) => {
      const dateA = parseDate(a.VENCIMENTO);
      const dateB = parseDate(b.VENCIMENTO);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA - dateB;
    });
  }
  return groups;
};
const calculateFIFOMetrics = (lotes, giroProduto = 'Médio giro') => {
  if (!lotes || lotes.length === 0) return null;
  const rateMap = { 'Grande giro': 5.2, 'Médio giro': 2.5, 'Pouco giro': 0.8 };
  const dailyRate = rateMap[giroProduto] || 2.5;
  const now = today();
  let totalRemaining = 0;
  let consumptionDays = 0;
  let totalInitial = 0;
  let soldEstimate = 0;
  for (const lote of lotes) {
    const qty = qtyToNumber(lote.quantidade);
    totalInitial += qty;
    const sendDate = parseDate(lote.DATAENVIO) || now;
    const elapsedDays = Math.max(0, diffDays(now, sendDate));
    const soldThisLote = Math.round(elapsedDays * dailyRate);
    const remainingQty = Math.max(0, qty - soldThisLote);
    totalRemaining += remainingQty;
    soldEstimate += soldThisLote;
    if (remainingQty > 0) {
      const daysForThisLote = Math.ceil(remainingQty / dailyRate);
      consumptionDays += daysForThisLote;
      const depletionDate = addDays(now, consumptionDays);
      return {
        totalRemaining,
        remainingQtyByLote: lotes.map(l => {
          const q = qtyToNumber(l.quantidade);
          const sDate = parseDate(l.DATAENVIO) || now;
          const eDays = Math.max(0, diffDays(now, sDate));
          const sold = Math.round(eDays * dailyRate);
          const rem = Math.max(0, q - sold);
          return { ...l, remainingQty: rem };
        }),
        depletionDate,
        depletionDateLabel: fmt(depletionDate),
        depletionDateFull: fmtFull(depletionDate),
        remainingDays: consumptionDays,
        dailyRate,
        giro: giroProduto,
        soldEstimate,
        totalInitial,
        salesPct: totalInitial > 0 ? Math.min(100, Math.round((soldEstimate / totalInitial) * 100)) : 0,
        remainingPct: totalRemaining > 0 ? Math.round((totalRemaining / totalInitial) * 100) : 0,
      };
    }
  }
  return {
    totalRemaining: 0,
    remainingQtyByLote: lotes.map(l => ({ ...l, remainingQty: 0 })),
    depletionDate: now,
    depletionDateLabel: 'HOJE',
    depletionDateFull: fmtFull(now),
    remainingDays: 0,
    dailyRate,
    giro: giroProduto,
    soldEstimate: totalInitial,
    totalInitial,
    salesPct: 100,
    remainingPct: 0,
  };
};
const buildDepletionMetricsOriginal = (product = {}) => {
  const qty = Math.max(0, qtyToNumber(product?.quantidade));
  const giro = product?.MARGEM || 'Médio giro';
  const rateMap = { 'Grande giro': 5.2, 'Médio giro': 2.5, 'Pouco giro': 0.8 };
  const dailyRate = rateMap[giro] || 2.5;
  const now = today(); const sendDate = parseDate(product?.DATAENVIO) || now;
  const elapsedDays = Math.max(0, diffDays(now, sendDate));
  const soldEstimate = Math.round(elapsedDays * dailyRate);
  const initialEstimate = Math.max(qty, qty + soldEstimate);
  const remainingQty = Math.max(0, qty - soldEstimate);
  const remainingDays = dailyRate > 0 ? Math.ceil(remainingQty / dailyRate) : 999;
  const depletionDate = addDays(now, remainingDays);
  const cycleTotal = elapsedDays + remainingDays;
  const cyclePct = cycleTotal > 0 ? Math.round((elapsedDays / cycleTotal) * 100) : 0;
  const salesPct = initialEstimate > 0 ? Math.min(100, Math.round((soldEstimate / initialEstimate) * 100)) : 0;
  const remainingPct = qty > 0 ? Math.round((remainingQty / qty) * 100) : 0;
  return { qty, giro, dailyRate, elapsedDays, remainingDays, depletionDate, depletionDateLabel: fmt(depletionDate), depletionDateFull: fmtFull(depletionDate), soldEstimate, initialEstimate, salesPct, cyclePct, remainingPct, remainingQty, cycleTotal };
};
// ── Agrupa produtos por nome (primeiros 6 chars norm.) para FIFO sem EAN ─────
const groupProductsByName = (products) => {
  const groups = new Map();
  for (const prod of products) {
    const key = stripAccents((prod.produto || '').toLowerCase().trim()).substring(0, 8);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(prod);
  }
  for (const [, lotes] of groups.entries()) {
    lotes.sort((a, b) => {
      const da = parseDate(a.VENCIMENTO), db = parseDate(b.VENCIMENTO);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return da - db;
    });
  }
  return groups;
};

// ── Detecta se o estoque tem grupos FIFO (por EAN ou nome ≥4 itens) ──────────
const detectFifoGroups = (products) => {
  if (!products || products.length === 0) return { hasFifo: false, groups: [] };
  const eanCount = {};
  for (const p of products) {
    const ean = (p.codig||'').trim();
    if (ean && ean !== 'Sem EAN') eanCount[ean] = (eanCount[ean]||0) + 1;
  }
  const nameCount = {};
  for (const p of products) {
    const k = stripAccents((p.produto||'').toLowerCase().trim()).substring(0, 8);
    if (k) nameCount[k] = (nameCount[k]||0) + 1;
  }
  const eanGroups = Object.entries(eanCount).filter(([,c]) => c >= 2).map(([ean, count]) => ({ key: ean, type: 'ean', count }));
  const nameGroups = Object.entries(nameCount).filter(([,c]) => c >= 4).map(([name, count]) => ({ key: name, type: 'nome', count }));
  const groups = [...eanGroups, ...nameGroups];
  return { hasFifo: groups.length > 0, groups };
};

const buildDepletionMetrics = (productOrLotes, fifoMode = false, allProducts = null, ean = null) => {
  if (!fifoMode || !allProducts) {
    return buildDepletionMetricsOriginal(productOrLotes);
  }
  // 1) Tenta agrupamento por EAN
  const eanGroups = groupProductsByEAN(allProducts);
  let lotes = ean ? eanGroups.get(ean) : null;

  // 2) Se sem EAN ou grupo de 1, tenta agrupamento por nome (≥2 itens)
  if (!lotes || lotes.length <= 1) {
    const nomeProduto = stripAccents((productOrLotes?.produto || '').toLowerCase().trim());
    if (nomeProduto.length >= 4) {
      const nameKey = nomeProduto.substring(0, Math.min(8, nomeProduto.length));
      const nameGroups = groupProductsByName(allProducts);
      const nameLotes = nameGroups.get(nameKey);
      if (nameLotes && nameLotes.length >= 2) lotes = nameLotes;
    }
  }

  if (!lotes || lotes.length === 0) return buildDepletionMetricsOriginal(productOrLotes);
  const giroProduto = lotes[0]?.MARGEM || 'Médio giro';
  const metrics = calculateFIFOMetrics(lotes, giroProduto);
  if (!metrics) return buildDepletionMetricsOriginal(productOrLotes);
  return {
    qty: metrics.totalRemaining,
    giro: metrics.giro,
    dailyRate: metrics.dailyRate,
    elapsedDays: 0,
    remainingDays: metrics.remainingDays,
    depletionDate: metrics.depletionDate,
    depletionDateLabel: metrics.depletionDateLabel,
    depletionDateFull: metrics.depletionDateFull,
    soldEstimate: metrics.soldEstimate,
    initialEstimate: metrics.totalInitial,
    salesPct: metrics.salesPct,
    cyclePct: 0,
    remainingPct: metrics.remainingPct,
    remainingQty: metrics.totalRemaining,
    cycleTotal: 0,
    lotes: metrics.remainingQtyByLote,
    fifoMode: true,
  };
};

const makeVENC = (theme) => ({
  expired: { color: theme.red, glow: theme.redGlow, icon: 'alert-circle', label: d => `Vencido há ${Math.abs(d)}d` },
  warning: { color: theme.amber, glow: theme.amberGlow, icon: 'alert-triangle', label: d => `Vence em ${d}d` },
  warning30: { color: theme.teal, glow: theme.tealGlow, icon: 'calendar', label: d => `Vence em ${d}d` },
  ok: { color: theme.green, glow: theme.greenGlow, icon: 'check-circle', label: v => `Vence: ${v}` },
  unknown: { color: '#888', glow: 'transparent', icon: 'clock', label: () => 'Sem data' },
});

const FILTERS = [
  { key: 'all', label: 'Todos', icon: 'list', colorKey: 'blue' },
  { key: 'ok', label: 'Seguros', icon: 'check-circle', colorKey: 'green' },
  { key: 'warning30', label: '30 Dias', icon: 'calendar', colorKey: 'teal' },
  { key: 'warning', label: '7 Dias', icon: 'alert-triangle', colorKey: 'amber' },
  { key: 'expired', label: 'Vencidos', icon: 'alert-circle', colorKey: 'red' },
];

const shlabel = k => SHELF_LABEL[k] || k || '—';
const normShelf = raw => { if (!raw) return ''; const s = String(raw).trim().toLowerCase(); return SHELF_ALIAS[s] || (SHELF_KEYS.includes(s) ? s : ''); };
const extractShelf = f => { if (!f) return ''; if (Array.isArray(f)) { const x = f[0]; return normShelf(typeof x === 'object' ? (x?.value || '') : String(x)); } return normShelf(String(f)); };
const roleLabel = p => (p === 'Cordenador' || p === 'Coordenador') ? 'Coordenador' : p === 'Deposito' || p === 'Depósito' ? 'Depósito' : p || '';
const isCoord = p => p === 'Cordenador' || p === 'Coordenador';
const isDeposito = p => p === 'Deposito' || p === 'Depósito';
const isRepositor = p => p === 'Repositor';
const canSwitch = p => isCoord(p) || isDeposito(p);
const getInitials = (name = '') => { const parts = String(name).trim().split(/\s+/).filter(Boolean); if (!parts.length) return 'GE'; if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase(); return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase(); };
const shelfPalette = (theme, key) => ({
  bebida: { accent: theme.blue, glow: theme.blueGlow, icon: 'droplet', emoji: '🥤' },
  macarrao: { accent: theme.amber, glow: theme.amberGlow, icon: 'disc', emoji: '🍝' },
  pesado: { accent: theme.orange, glow: theme.orangeGlow, icon: 'package', emoji: '📦' },
  frios: { accent: theme.teal, glow: theme.tealGlow, icon: 'cloud-snow', emoji: '❄️' },
  biscoito: { accent: theme.purple, glow: theme.purpleGlow, icon: 'coffee', emoji: '🍪' },
}[key] || { accent: theme.blue, glow: theme.blueGlow, icon: 'grid', emoji: '🗂️' });
const rolePal = (theme, p) => { if (isCoord(p)) return { bg: theme.amberGlow, fg: theme.amber, icon: 'shield' }; if (isDeposito(p)) return { bg: theme.orangeGlow, fg: theme.orange, icon: 'archive' }; return { bg: theme.blueGlow, fg: theme.blue, icon: 'user' }; };

const useCountUp = (target, ms = 380) => {
  const [val, setVal] = useState(target);
  const from = useRef(target); const raf = useRef();
  useEffect(() => {
    const a = from.current, b = target;
    if (a === b) return;
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - t0) / ms, 1);
      const e = 1 - Math.pow(1 - p, 4);
      setVal(Math.round(a + (b - a) * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return val;
};

const AutoCleanToast = ({ data, onClose, T, fontScale }) => {
  const slideA = useRef(new Animated.Value(-220)).current;
  const opacA = useRef(new Animated.Value(0)).current;
  const scaleA = useRef(new Animated.Value(0.88)).current;
  const trashA = useRef(new Animated.Value(0)).current;
  const progressA = useRef(new Animated.Value(1)).current;
  const [modalVis, setModalVis] = useState(false);
  const dismissedRef = useRef(false);
  const deletedCount = data.deleted?.length ?? 0;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideA, { toValue: 0, tension: 70, friction: 11, useNativeDriver: false }),
      Animated.timing(opacA, { toValue: 1, duration: 280, useNativeDriver: false }),
      Animated.spring(scaleA, { toValue: 1, tension: 90, friction: 10, useNativeDriver: false }),
    ]).start();
  }, [slideA, opacA, scaleA]);

  useEffect(() => {
    if (deletedCount === 0) {
      progressA.setValue(1);
      Animated.timing(progressA, { toValue: 0, duration: 1200, useNativeDriver: false }).start();
      const t = setTimeout(() => dismiss(), 1200);
      return () => clearTimeout(t);
    }
  }, [deletedCount, progressA, dismiss]);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.parallel([
      Animated.timing(slideA, { toValue: -250, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
      Animated.timing(opacA, { toValue: 0, duration: 220, useNativeDriver: false }),
    ]).start(() => onClose());
  }, [slideA, opacA, onClose]);

  const trashRot = trashA.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-15deg', '0deg', '15deg'] });

  if (data.cleaning) {
    return (
      <Animated.View style={{ position: 'absolute', top: 60 + (Platform.OS === 'android' ? 20 : 44), left: 16, right: 16, backgroundColor: T.bgCard, borderRadius: 20, padding: 16, borderWidth: 1.5, borderColor: T.amber + '60', flexDirection: 'row', alignItems: 'center', gap: 12, transform: [{ translateY: slideA }, { scale: scaleA }], opacity: opacA, shadowColor: T.amber, shadowOpacity: 0.3, shadowRadius: 16, elevation: 14, zIndex: 9998 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.amberGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.amber + '50' }}><ActivityIndicator size="small" color={T.amber} /></View>
        <View style={{ flex: 1 }}><Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.amber, textTransform: 'uppercase', letterSpacing: 0.8 }}>Limpeza automática</Text><Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '700', marginTop: 2 }}>Verificando produtos vencidos há +30 dias...</Text></View>
      </Animated.View>
    );
  }

  if (deletedCount === 0) {
    return (
      <Animated.View style={{ position: 'absolute', top: 60 + (Platform.OS === 'android' ? 20 : 44), left: 16, right: 16, backgroundColor: T.bgCard, borderRadius: 20, padding: 16, borderWidth: 1.5, borderColor: T.green + '50', flexDirection: 'column', gap: 10, transform: [{ translateY: slideA }, { scale: scaleA }], opacity: opacA, shadowColor: T.green, shadowOpacity: 0.25, shadowRadius: 14, elevation: 12, zIndex: 9998 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: -4 }}>
          <TouchableOpacity onPress={dismiss} style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
            <Feather name="x" size={14} color={T.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.greenGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.green + '50' }}>
            <Feather name="check-circle" size={22} color={T.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.green, textTransform: 'uppercase', letterSpacing: 0.8 }}>Estoque limpo ✓</Text>
            <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '700', marginTop: 1 }}>Nenhum produto vencido há +30 dias.</Text>
          </View>
        </View>
        <View style={{ marginTop: 8, height: 4, backgroundColor: T.border, borderRadius: 2, overflow: 'hidden' }}>
          <Animated.View style={{ height: '100%', backgroundColor: T.green, borderRadius: 2, width: progressA.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        </View>
      </Animated.View>
    );
  }

  return (
    <>
      <Animated.View style={{ position: 'absolute', top: 60 + (Platform.OS === 'android' ? 20 : 44), left: 16, right: 16, backgroundColor: T.bgCard, borderRadius: 22, borderWidth: 2, borderColor: T.red + '55', transform: [{ translateY: slideA }, { scale: scaleA }], opacity: opacA, shadowColor: T.red, shadowOpacity: 0.35, shadowRadius: 20, elevation: 16, zIndex: 9998, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 12 }}>
          <Animated.View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.red + '50', transform: [{ rotate: trashRot }] }}><Feather name="trash-2" size={22} color={T.red} /></Animated.View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.red, textTransform: 'uppercase', letterSpacing: 0.8 }}>Limpeza automática</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 }}><Text style={{ fontSize: 28 * fontScale, fontWeight: '900', color: T.red, letterSpacing: -1 }}>{deletedCount}</Text><Text style={{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }}>produto{deletedCount !== 1 ? 's' : ''} removido{deletedCount !== 1 ? 's' : ''}</Text></View>
          </View>
          <View style={{ gap: 6, alignItems: 'flex-end' }}>
            <TouchableOpacity onPress={dismiss} style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center' }}><Feather name="x" size={14} color={T.textMuted} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setModalVis(true)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: T.red + '18', borderWidth: 1, borderColor: T.red + '40' }}><Text style={{ fontSize: 9.5 * fontScale, fontWeight: '900', color: T.red }}>Ver lista</Text></TouchableOpacity>
          </View>
        </View>
        <View style={{ height: 3, backgroundColor: T.red, opacity: 0.7 }} />
      </Animated.View>
      <Modal visible={modalVis} transparent animationType="fade" onRequestClose={() => setModalVis(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 20 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setModalVis(false)} />
          <View style={{ backgroundColor: T.bgCard, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: T.red + '40', maxHeight: WIN.height * 0.75 }}>
            <View style={{ backgroundColor: T.red + '18', padding: 22, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderColor: T.red + '25' }}>
              <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: T.red + '25', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.red + '50' }}><Feather name="trash-2" size={24} color={T.red} /></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.red, textTransform: 'uppercase', letterSpacing: 1 }}>Relatório de Limpeza</Text><Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text, marginTop: 2 }}>{deletedCount} produto{deletedCount !== 1 ? 's' : ''} excluído{deletedCount !== 1 ? 's' : ''}</Text></View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }} showsVerticalScrollIndicator={false}>
              {data.deleted.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.bgElevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: T.border }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: T.red + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.red + '35' }}><Text style={{ fontSize: 11, fontWeight: '900', color: T.red }}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: T.text }} numberOfLines={1}>{item.nome}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: T.red + '15', borderWidth: 1, borderColor: T.red + '30' }}><Text style={{ fontSize: 9.5 * fontScale, fontWeight: '800', color: T.red }}>Venceu {item.vencimento}</Text></View>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 9.5 * fontScale, fontWeight: '700', color: T.textSub }}>{item.dias}d atrás</Text></View>
                    </View>
                  </View>
                  <Feather name="check-circle" size={18} color={T.green} />
                </View>
              ))}
            </ScrollView>
            <View style={{ padding: 16, borderTopWidth: 1, borderColor: T.border }}>
              <TouchableOpacity onPress={() => { setModalVis(false); dismiss(); }} style={{ height: 50, borderRadius: 14, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}><Feather name="check" size={17} color="#FFF" /><Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: '#FFF' }}>Entendido</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const SuccessOverlay = ({ visible, onClose, T, fontScale }) => {
  const scale = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.5)).current;
  const timeoutRef = useRef(null);
  useEffect(() => {
    if (visible) {
      scale.setValue(0); rotate.setValue(0); opacity.setValue(0); ringScale.setValue(0.5);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, tension: 90, friction: 8, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.spring(ringScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: false }),
      ]).start();
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.timing(rotate, { toValue: -1, duration: 600, useNativeDriver: false }),
        Animated.timing(rotate, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]));
      loop.start();
      timeoutRef.current = setTimeout(() => { loop.stop(); onClose(); }, 2500);
    } else { if (timeoutRef.current) clearTimeout(timeoutRef.current); }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [visible, onClose, scale, rotate, opacity, ringScale]);
  const rotateInterp = rotate.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-12deg', '0deg', '12deg'] });
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.88)', opacity }]} />
      <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
        <Animated.View style={{ transform: [{ scale: ringScale }] }}>
          <View style={{ width: 140, height: 140, borderRadius: 70, backgroundColor: T.green + '20', justifyContent: 'center', alignItems: 'center' }}>
            <Animated.View style={{ width: 110, height: 110, borderRadius: 55, backgroundColor: T.green, justifyContent: 'center', alignItems: 'center', transform: [{ scale }, { rotate: rotateInterp }], shadowColor: T.green, shadowOpacity: 0.7, shadowRadius: 20, elevation: 12 }}><Feather name="check" size={60} color="#FFF" /></Animated.View>
          </View>
        </Animated.View>
        <Animated.Text style={{ marginTop: 32, fontSize: 28 * fontScale, fontWeight: '900', color: '#FFF', textAlign: 'center', opacity, transform: [{ scale }] }}>Cadastro Concluído!</Animated.Text>
        <Animated.Text style={{ marginTop: 12, fontSize: 16 * fontScale, color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingHorizontal: 32, opacity }}>Produto adicionado com sucesso.</Animated.Text>
      </View>
    </View>
  );
};

const ProductDetailModalContent = ({ product, visible, onClose, onDelete, onUpdateQuantity, T, fontScale, fifoMode, allProducts }) => {
  const slideA = useRef(new Animated.Value(WIN.height)).current;
  const opacA = useRef(new Animated.Value(0)).current;
  const headerA = useRef(new Animated.Value(0)).current;
  const card1A = useRef(new Animated.Value(40)).current;
  const card2A = useRef(new Animated.Value(60)).current;
  const card3A = useRef(new Animated.Value(80)).current;
  const card4A = useRef(new Animated.Value(100)).current;
  const pulseA = useRef(new Animated.Value(1)).current;
  const barA = useRef(new Animated.Value(0)).current;
  const soldBarA = useRef(new Animated.Value(0)).current;
  const glowA = useRef(new Animated.Value(0)).current;
  const [addQtyValue, setAddQtyValue] = useState(1);

  useEffect(() => { if (visible) setAddQtyValue(1); }, [visible, product?.id]);

  const GIRO = useMemo(() => makeGiro(T), [T]);
  const VENC = useMemo(() => makeVENC(T), [T]);
  const metrics = useMemo(() => {
    if (fifoMode && allProducts && product?.codig) {
      const groups = groupProductsByEAN(allProducts);
      const lotes = groups.get(product.codig);
      if (lotes && lotes.length > 0) {
        return buildDepletionMetrics(lotes[0], true, allProducts, product.codig);
      }
    }
    return buildDepletionMetrics(product, false);
  }, [product, fifoMode, allProducts]);
  const g = GIRO[metrics.giro] || { color: T.textSub, glow: T.bgInput, icon: 'minus', short: '—', rate: 2.5 };
  const vs = vencStatus(product?.VENCIMENTO);
  const vc = VENC[vs.status];
  const animRem = useCountUp(metrics.remainingQty, 900);
  const animSold = useCountUp(metrics.soldEstimate, 700);
  const animPct = useCountUp(metrics.remainingPct, 800);
  const stockColor = metrics.remainingPct <= 0 ? T.red : metrics.remainingPct <= 15 ? T.red : metrics.remainingPct <= 35 ? T.amber : T.green;
  
  useEffect(() => {
    if (visible) {
      slideA.setValue(WIN.height); opacA.setValue(0); headerA.setValue(0); 
      card1A.setValue(40); card2A.setValue(60); card3A.setValue(80); card4A.setValue(100); 
      barA.setValue(0); soldBarA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 52, friction: 11, useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start(() => {
        Animated.stagger(80, [
          Animated.spring(headerA, { toValue: 1, tension: 100, friction: 12, useNativeDriver: false }),
          Animated.spring(card1A, { toValue: 0, tension: 90, friction: 11, useNativeDriver: false }),
          Animated.spring(card2A, { toValue: 0, tension: 90, friction: 11, useNativeDriver: false }),
          Animated.spring(card3A, { toValue: 0, tension: 90, friction: 11, useNativeDriver: false }),
          Animated.spring(card4A, { toValue: 0, tension: 90, friction: 11, useNativeDriver: false }),
        ]).start();
        setTimeout(() => {
          Animated.timing(barA, { toValue: metrics.remainingPct, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
          Animated.timing(soldBarA, { toValue: metrics.salesPct, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
        }, 350);
      });
      if (metrics.remainingPct <= 15) {
        const loop = Animated.loop(Animated.sequence([
          Animated.timing(pulseA, { toValue: 1.03, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulseA, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]));
        const glowLoop = Animated.loop(Animated.sequence([
          Animated.timing(glowA, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(glowA, { toValue: 0, duration: 800, useNativeDriver: false }),
        ]));
        loop.start(); glowLoop.start();
        return () => { loop.stop(); glowLoop.stop(); };
      } else { pulseA.setValue(1); glowA.setValue(0); }
    } else {
      Animated.parallel([
        Animated.timing(slideA, { toValue: WIN.height, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]).start();
    }
  }, [visible, metrics.remainingPct, metrics.salesPct, slideA, opacA, headerA, card1A, card2A, card3A, card4A, barA, soldBarA, pulseA, glowA]);

  const obs = useMemo(() => {
    const list = [];
    if (metrics.elapsedDays > 0) list.push(`📦 Lote no estoque há ${metrics.elapsedDays} dia${metrics.elapsedDays !== 1 ? 's' : ''} (desde ${product?.DATAENVIO ? fmtFull(parseDate(product.DATAENVIO)) : '\u2014'}).`);
    if (metrics.soldEstimate > 0) list.push(`📉 Estimativa: ~${metrics.soldEstimate} unidade${metrics.soldEstimate !== 1 ? 's' : ''} vendida${metrics.soldEstimate !== 1 ? 's' : ''} desde a entrada.`);
    if (metrics.remainingQty <= 0) list.push(`⛔ Ruptura total estimada! Solicite reposição urgente.`);
    else if (metrics.remainingPct <= 15) list.push(`🔴 Estoque crítico — apenas ${metrics.remainingQty} unidades restantes. Solicitar reposição!`);
    else if (metrics.remainingPct <= 35) list.push(`🟡 Estoque em declínio — programe reposição para os próximos dias.`);
    else list.push(`🟢 Estoque saudável por mais ${metrics.remainingDays} dia${metrics.remainingDays !== 1 ? 's' : ''}.`);
    if (vs.status === 'expired') list.push(`🛑 Produto VENCIDO há ${Math.abs(vs.days)} dias — retirar da gôndola imediatamente.`);
    else if (vs.status === 'warning') list.push(`⚡ Validade em ${vs.days} dia${vs.days !== 1 ? 's' : ''} — priorize a venda.`);
    if (metrics.dailyRate >= 5) list.push(`⚡ Alta rotatividade — monitore o estoque diariamente.`);
    else if (metrics.dailyRate <= 1) list.push(`🐢 Baixa rotatividade — atenção ao prazo de validade.`);
    if (fifoMode && metrics.lotes && metrics.lotes.length > 1) {
      list.push(`📦 Modo FIFO ativo: ${metrics.lotes.length} lotes do mesmo produto. Consumo pelo mais antigo primeiro.`);
    }
    return list;
  }, [metrics, vs, product, fifoMode]);

  const sendDate = parseDate(product?.DATAENVIO);
  const sendDateLabel = sendDate ? fmtFull(sendDate) : '—';
  const barWidth = barA.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  const soldBarWidth = soldBarA.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', opacity: opacA }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: T.bgCard, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingBottom: 32 + NAV_BAR_H, borderTopWidth: 2, borderColor: stockColor + '60', maxHeight: WIN.height * 0.94, transform: [{ translateY: slideA }], shadowColor: '#000', shadowOffset: { width: 0, height: -16 }, shadowOpacity: 0.55, shadowRadius: 36, elevation: 32 }}>
          <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 4 }}><Animated.View style={{ width: 50, height: 5, backgroundColor: stockColor, borderRadius: 3, opacity: glowA.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }} /></View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 16 }}>
            <Animated.View style={{ opacity: headerA, transform: [{ translateY: headerA.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }], marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: metrics.remainingPct <= 0 ? T.redGlow : metrics.remainingPct <= 15 ? T.redGlow : metrics.remainingPct <= 35 ? T.amberGlow : T.greenGlow, borderWidth: 1.5, borderColor: stockColor + '50' }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: stockColor, letterSpacing: 0.5 }}>{metrics.remainingPct <= 0 ? '💀 RUPTURA' : metrics.remainingPct <= 15 ? '🚨 CRÍTICO' : metrics.remainingPct <= 35 ? '⚠️ ATENÇÃO' : '✅ SEGURO'}</Text></View>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: g.glow, borderWidth: 1, borderColor: g.color + '40' }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: g.color }}>{metrics.giro}</Text></View>
                    {vs.status !== 'unknown' && (<View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: vc.glow, borderWidth: 1, borderColor: vc.color + '40' }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: vc.color }}>{vs.status === 'expired' ? `Vencido ${Math.abs(vs.days)}d` : vs.status === 'warning' ? `Vence ${vs.days}d` : 'Válido'}</Text></View>)}
                  </View>
                  <Text style={{ fontSize: 22 * fontScale, fontWeight: '900', color: T.text, letterSpacing: -0.5, lineHeight: 28 * fontScale }} numberOfLines={3}>{product.produto || 'Produto sem nome'}</Text>
                  {sendDate && (<Text style={{ fontSize: 11 * fontScale, color: T.textSub, fontWeight: '700', marginTop: 6 }}>📅 Entrada: {sendDateLabel} · {metrics.elapsedDays}d em estoque</Text>)}
                  {product.PREVISAO && (<Text style={{ fontSize: 11 * fontScale, color: T.purple, fontWeight: '700', marginTop: 4 }}>📉 Previsão de ruptura: {product.PREVISAO}</Text>)}
                  {fifoMode && metrics.lotes && metrics.lotes.length > 1 && (<Text style={{ fontSize: 11 * fontScale, color: T.blue, fontWeight: '800', marginTop: 4 }}>📦 {metrics.lotes.length} lotes agrupados (FIFO)</Text>)}
                </View>
                <TouchableOpacity onPress={onClose} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border, justifyContent: 'center', alignItems: 'center' }}><Feather name="x" size={18} color={T.textSub} /></TouchableOpacity>
              </View>
            </Animated.View>

            <Animated.View style={{ transform: [{ translateY: card1A }], marginBottom: 14 }}>
              <Animated.View style={{ backgroundColor: T.bgElevated, borderRadius: 28, padding: 22, borderWidth: 2, borderColor: stockColor + '50', shadowColor: stockColor, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10, transform: [{ scale: pulseA }] }}>
                <Animated.View style={{ ...StyleSheet.absoluteFillObject, borderRadius: 28, backgroundColor: stockColor, opacity: glowA.interpolate({ inputRange: [0, 1], outputRange: [0, 0.04] }) }} />
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: stockColor, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 16 }}>Estoque Total Estimado</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 18 }}>
                  <Text style={{ fontSize: 72 * fontScale, fontWeight: '900', color: stockColor, letterSpacing: -3, lineHeight: 72 * fontScale }}>{animRem}</Text>
                  <View style={{ paddingBottom: 10 }}><Text style={{ fontSize: 16 * fontScale, fontWeight: '700', color: T.textSub }}>un</Text><Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: T.textMuted }}>restantes</Text></View>
                  <View style={{ flex: 1, alignItems: 'flex-end', paddingBottom: 8 }}><Text style={{ fontSize: 36 * fontScale, fontWeight: '900', color: stockColor, opacity: 0.7 }}>{animPct}%</Text><Text style={{ fontSize: 10 * fontScale, color: T.textMuted, fontWeight: '700' }}>do total</Text></View>
                </View>
                <View style={{ marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Restante</Text><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: stockColor }}>{animPct}%</Text></View>
                  <View style={{ height: 12, backgroundColor: T.bgInput, borderRadius: 6, overflow: 'hidden' }}><Animated.View style={{ height: '100%', borderRadius: 6, width: barWidth, backgroundColor: stockColor }} /></View>
                </View>
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Estimativa vendida</Text><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: g.color }}>{animSold} un</Text></View>
                  <View style={{ height: 8, backgroundColor: T.bgInput, borderRadius: 4, overflow: 'hidden' }}><Animated.View style={{ height: '100%', borderRadius: 4, width: soldBarWidth, backgroundColor: g.color + '80' }} /></View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  {[
                    { label: 'Total entradas', val: `${metrics.initialEstimate} un`, icon: 'package', c: T.blue }, 
                    { label: 'Vendidas ~', val: `${animSold} un`, icon: 'trending-down', c: g.color }, 
                    { label: 'Saída/dia', val: `~${metrics.dailyRate.toFixed(1)}`, icon: 'zap', c: T.purple }
                  ].map(b => (
                    <View key={b.label} style={{ flex: 1, backgroundColor: T.bgCard, borderRadius: 14, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: b.c + '20' }}>
                      <Feather name={b.icon} size={14} color={b.c} />
                      <Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: b.c, marginTop: 4 }}>{b.val}</Text>
                      <Text style={{ fontSize: 8.5 * fontScale, color: T.textMuted, fontWeight: '700', marginTop: 2 }}>{b.label}</Text>
                    </View>
                  ))}
                </View>
              </Animated.View>
            </Animated.View>

            {fifoMode && metrics.lotes && metrics.lotes.length > 1 && (
              <Animated.View style={{ transform: [{ translateY: card2A }], marginBottom: 14 }}>
                <View style={{ backgroundColor: T.bgCard, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: T.border }}>
                  <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Detalhamento dos Lotes (FIFO)</Text>
                  {metrics.lotes.map((lote, idx) => {
                    const qty = qtyToNumber(lote.quantidade);
                    const remaining = lote.remainingQty !== undefined ? lote.remainingQty : Math.max(0, qty - Math.max(0, diffDays(today(), parseDate(lote.DATAENVIO) || today()) * metrics.dailyRate));
                    const vsLote = vencStatus(lote.VENCIMENTO);
                    const vcLote = VENC[vsLote.status];
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: idx > 0 ? 1 : 0, borderColor: T.border }}>
                        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: remaining > 0 ? T.blueGlow : T.redGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: remaining > 0 ? T.blue : T.red }}>
                          <Text style={{ fontSize: 12, fontWeight: '900', color: remaining > 0 ? T.blue : T.red }}>{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12 * fontScale, fontWeight: '800', color: T.text }} numberOfLines={1}>{lote.produto}</Text>
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                            <Text style={{ fontSize: 10 * fontScale, color: T.textSub, fontWeight: '700' }}>Estoque: {Math.max(0, remaining)} un</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Feather name={vcLote.icon} size={10} color={vcLote.color} />
                              <Text style={{ fontSize: 10 * fontScale, fontWeight: '700', color: vcLote.color }}>{lote.VENCIMENTO || '—'}</Text>
                            </View>
                          </View>
                        </View>
                        <Feather name={remaining > 0 ? "check-circle" : "x-circle"} size={16} color={remaining > 0 ? T.green : T.red} />
                      </View>
                    );
                  })}
                </View>
              </Animated.View>
            )}

            <Animated.View style={{ transform: [{ translateY: card3A }], marginBottom: 14 }}>
              <View style={{ backgroundColor: T.bgCard, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: T.border }}>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Linha do Tempo (Ruptura Estimada)</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ alignItems: 'center', width: 32 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.blue + '40' }}><Feather name="log-in" size={14} color={T.blue} /></View>
                    <View style={{ width: 2, flex: 1, backgroundColor: T.border, marginVertical: 4 }} />
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 8 }}>📍</Text></View>
                    <View style={{ width: 2, flex: 1, backgroundColor: T.border, marginVertical: 4 }} />
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: stockColor + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: stockColor + '40' }}><Feather name="alert-circle" size={14} color={stockColor} /></View>
                  </View>
                  <View style={{ flex: 1, justifyContent: 'space-between' }}>
                    <View style={{ marginBottom: 18 }}>
                      <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase' }}>Primeiro Lote</Text>
                      <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.text, marginTop: 2 }}>{sendDateLabel}</Text>
                      <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 1 }}>{metrics.initialEstimate} unidades cadastradas</Text>
                    </View>
                    <View style={{ marginBottom: 18 }}>
                      <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase' }}>Hoje</Text>
                      <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.text, marginTop: 2 }}>{fmtFull(today())}</Text>
                      <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 1 }}>~{metrics.remainingQty} unidades restantes</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: stockColor, textTransform: 'uppercase' }}>Ruptura Estimada</Text>
                      <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: stockColor, marginTop: 2 }}>{metrics.depletionDateFull}</Text>
                      <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 1 }}>em ~{metrics.remainingDays} dia{metrics.remainingDays !== 1 ? 's' : ''}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </Animated.View>

            {product.VENCIMENTO?.trim() && (
              <Animated.View style={{ transform: [{ translateY: card4A }], marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: vc.glow, borderRadius: 18, padding: 16, borderWidth: 1.5, borderColor: vc.color + '50' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: vc.color + '25', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: vc.color + '50' }}><Feather name={vc.icon} size={22} color={vc.color} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: vc.color, textTransform: 'uppercase', letterSpacing: 0.8 }}>Validade do Lote Mais Antigo</Text>
                    <Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: vc.color, marginTop: 3 }}>{vs.status === 'expired' ? vc.label(vs.days) : vs.status === 'warning' ? vc.label(vs.days) : vc.label(product.VENCIMENTO)}</Text>
                    <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 2, fontWeight: '700' }}>Data: {product.VENCIMENTO}</Text>
                  </View>
                </View>
              </Animated.View>
            )}

            <Animated.View style={{ transform: [{ translateY: card4A }], marginBottom: 20 }}>
              <View style={{ backgroundColor: T.bgElevated, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: T.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.blue + '40' }}><MaterialCommunityIcons name="robot-outline" size={16} color={T.blue} /></View>
                  <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 0.8 }}>Observações GEI.AI</Text>
                </View>
                {obs.map((o, i) => (<View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderColor: T.border }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.blue, marginTop: 6, flexShrink: 0 }} /><Text style={{ flex: 1, fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', lineHeight: 19 * fontScale }}>{o}</Text></View>))}
              </View>
            </Animated.View>

            {/* ── Adicionar Quantidade — stepper + botão, posicionado ACIMA do "Apagar Produto" ── */}
            <View style={{ backgroundColor: T.bgElevated, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: T.border, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: T.greenGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.green + '40' }}><Feather name="plus-circle" size={16} color={T.green} /></View>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.green, textTransform: 'uppercase', letterSpacing: 0.8 }}>Adicionar Quantidade</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 14 }}>
                <TouchableOpacity onPress={() => setAddQtyValue(v => Math.max(1, v - 1))} style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
                  <Feather name="minus" size={19} color={T.text} />
                </TouchableOpacity>
                <TextInput
                  value={String(addQtyValue)}
                  onChangeText={txt => {
                    const digits = txt.replace(/[^0-9]/g, '');
                    if (digits === '') { setAddQtyValue(''); return; }
                    setAddQtyValue(parseInt(digits, 10));
                  }}
                  onBlur={() => setAddQtyValue(v => (!v || v < 1) ? 1 : v)}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  style={{ fontSize: 26 * fontScale, fontWeight: '900', color: T.text, minWidth: 72, textAlign: 'center', backgroundColor: T.bgInput, borderRadius: 14, paddingVertical: 8, borderWidth: 1, borderColor: T.border }}
                />
                <TouchableOpacity onPress={() => setAddQtyValue(v => (parseInt(v, 10) || 0) + 1)} style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
                  <Feather name="plus" size={19} color={T.text} />
                </TouchableOpacity>
              </View>
              <PrimaryBtn
                label={`Adicionar ${addQtyValue || 0} unidade${(addQtyValue || 0) !== 1 ? 's' : ''}`}
                icon="check"
                color={T.green}
                fontScale={fontScale}
                disabled={!addQtyValue || addQtyValue < 1}
                onPress={() => { onUpdateQuantity?.(product, parseInt(addQtyValue, 10) || 0); setAddQtyValue(1); }}
              />
            </View>

            <TouchableOpacity onPress={() => { if (onDelete && product) { AppAlert.alert('Apagar Produto', `Deseja apagar "${product.produto || 'este produto'}" permanentemente da prateleira?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Apagar', style: 'destructive', onPress: () => { onClose(); onDelete(product); } }]); } }} style={{ height: 52, borderRadius: 16, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: T.red + '50', marginBottom: 10 }}><Feather name="trash-2" size={18} color={T.red} /><Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.red }}>Apagar Produto</Text></TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ height: 52, borderRadius: 16, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, shadowColor: T.blue, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 }}><Feather name="check" size={18} color="#FFF" /><Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: '#FFF' }}>Fechar</Text></TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const ProductDetailModal = ({ product, visible, onClose, onDelete, onUpdateQuantity, T, fontScale, fifoMode, allProducts }) => {
  if (!product) return null;
  return (
    <ProductDetailModalContent
      product={product}
      visible={visible}
      onClose={onClose}
      onDelete={onDelete}
      onUpdateQuantity={onUpdateQuantity}
      T={T}
      fontScale={fontScale}
      fifoMode={fifoMode}
      allProducts={allProducts}
    />
  );
};

const PrimaryBtn = ({ label, icon, onPress, color, outline, style, fontScale = 1, disabled = false }) => (
  <TouchableOpacity activeOpacity={disabled ? 1 : 0.82} onPress={onPress} disabled={disabled} style={[styles.btn, {
    backgroundColor: outline ? 'transparent' : color,
    borderWidth: outline ? 1.5 : 0,
    borderColor: color,
    opacity: disabled ? 0.5 : 1,
    borderRadius: 18,
    shadowColor: outline ? 'transparent' : color,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: outline ? 0 : 0.28,
    shadowRadius: 14,
    elevation: outline ? 0 : 6,
  }, style]}>
    {icon && <Feather name={icon} size={18} color={outline ? color : '#FFF'} style={{ marginRight: 10 }} />}
    <Text style={[styles.btnTxt, { color: outline ? color : '#FFF', fontSize: 15 * fontScale, letterSpacing: 0.2 }]}>{label}</Text>
  </TouchableOpacity>
);
const ErrBanner = ({ msg, onClose }) => { if (!msg) return null; return (<View style={{ backgroundColor: '#DC2626', padding: 14, borderRadius: 14, marginHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 4 }}><Feather name="alert-circle" size={18} color="#FFF" /><Text style={{ color: '#FFF', fontWeight: '700', flex: 1, fontSize: 13 }}>{msg}</Text><TouchableOpacity onPress={onClose}><Feather name="x" size={18} color="#FFF" /></TouchableOpacity></View>); };
const ShelfQuickSelector = ({ current, onOpen, T, fontScale, title, subtitle }) => {
  const pal = shelfPalette(T, current);
  const canOpen = typeof onOpen === 'function';
  const Container = canOpen ? TouchableOpacity : View;
  const containerProps = canOpen ? { activeOpacity: 0.9, onPress: onOpen } : {};
  return (<Container {...containerProps} style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: T.border, flexDirection: 'row', alignItems: 'center', gap: 16, shadowColor: T.textMuted, shadowOpacity: 0.04, elevation: 2, opacity: canOpen ? 1 : 0.85 }}><View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: pal.glow, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: pal.accent + '30' }}><Feather name={pal.icon} size={26} color={pal.accent} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: pal.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{title}</Text><Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>{shlabel(current)}</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 4, fontWeight: '600' }}>{subtitle}</Text></View>{canOpen ? <Feather name="chevron-right" size={20} color={T.textMuted} /> : <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.textMuted }}>FIXO</Text></View>}</Container>);
};

const isProductRecent = (dataEnvio) => { if (!dataEnvio) return false; const date = parseDate(dataEnvio); if (!date) return false; return diffDays(today(), date) === 0; };
const isProductLast3Days = (dataEnvio) => { if (!dataEnvio) return false; const date = parseDate(dataEnvio); if (!date) return false; const diff = diffDays(today(), date); return diff >= 1 && diff <= 3; };

const CardList = ({ item, T, fontScale, onPress, fifoMode, allProducts }) => {
  const GIRO = makeGiro(T);
  const VENC = makeVENC(T);
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const metrics = useMemo(() => {
    if (fifoMode && allProducts && item?.codig) {
      const groups = groupProductsByEAN(allProducts);
      const lotes = groups.get(item.codig);
      if (lotes && lotes.length > 0) {
        return buildDepletionMetrics(lotes[0], true, allProducts, item.codig);
      }
    }
    return buildDepletionMetrics(item, false);
  }, [item, fifoMode, allProducts]);
  const g = GIRO[metrics.giro] || { color: T.textSub, glow: T.bgInput, icon: 'circle', short: '—', rate: 0 };
  const vs = vencStatus(item.VENCIMENTO); const vc = VENC[vs.status];
  const isNew = isProductRecent(item.DATAENVIO);
  const isRecent = isProductLast3Days(item.DATAENVIO);
  const pi = () => Animated.parallel([Animated.spring(scale, { toValue: 0.98, tension: 200, friction: 10, useNativeDriver: false }), Animated.timing(glow, { toValue: 1, duration: 150, useNativeDriver: false })]).start();
  const po = () => Animated.parallel([Animated.spring(scale, { toValue: 1, tension: 200, friction: 12, useNativeDriver: false }), Animated.timing(glow, { toValue: 0, duration: 200, useNativeDriver: false })]).start();
  return (
    <TouchableOpacity activeOpacity={0.98} onPress={() => onPress(item)} onPressIn={pi} onPressOut={po}>
      <Animated.View style={{ backgroundColor: T.bgCard, borderRadius: 22, marginBottom: 14, borderWidth: 1.5, borderColor: glow.interpolate({ inputRange: [0, 1], outputRange: [T.border, g.color + '60'] }), transform: [{ scale }], shadowColor: g.color, shadowOffset: { width: 0, height: 4 }, shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.15] }), shadowRadius: 12, elevation: 4, overflow: 'hidden', flexDirection: 'row' }}>
        {/* ── Barra lateral de status (substitui o ponto colorido) ── */}
        <View style={{ width: 5, backgroundColor: vs.status === 'expired' ? T.red : vs.status === 'warning' ? T.amber : T.green }} />
        <View style={{ flex: 1, padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <Text style={{ fontWeight: '900', fontSize: 16 * fontScale, color: T.text, lineHeight: 22, flex: 1, marginRight: 8 }} numberOfLines={2}>{String(item.produto || '').trim() || 'Produto sem nome'}</Text>
            <View style={{ backgroundColor: g.glow, borderWidth: 1, borderColor: g.color + '30', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, gap: 4 }}><Feather name={g.icon} size={10} color={g.color} /><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: g.color }}>{g.short}</Text></View>
          </View>
          {(isNew || isRecent) && (<View style={{ flexDirection: 'row', marginBottom: 8 }}><View style={{ backgroundColor: isNew ? T.green + '20' : T.blue + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: isNew ? T.green + '50' : T.blue + '50', flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name={isNew ? "zap" : "clock"} size={10} color={isNew ? T.green : T.blue} /><Text style={{ fontSize: 9 * fontScale, fontWeight: '800', color: isNew ? T.green : T.blue }}>{isNew ? "NOVO" : "RECENTE"}</Text></View></View>)}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1, backgroundColor: T.bgElevated, borderRadius: 13, padding: 10 }}>
              <Text style={{ fontSize: 9 * fontScale, fontWeight: '800', color: T.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Estoque</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: T.blue }}>{metrics.remainingQty}</Text><Text style={{ fontSize: 10, color: T.textSub, fontWeight: '700' }}>un</Text></View>
              <View style={{ height: 4, backgroundColor: T.bgInput, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}><View style={{ height: '100%', width: `${metrics.remainingPct}%`, backgroundColor: metrics.remainingPct < 20 ? T.red : T.blue, borderRadius: 2 }} /></View>
            </View>
            <View style={{ flex: 1, backgroundColor: T.purpleGlow, borderRadius: 13, padding: 10 }}>
              <Text style={{ fontSize: 9 * fontScale, fontWeight: '800', color: T.purple, textTransform: 'uppercase', marginBottom: 3 }}>Ruptura</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: T.purple }}>{metrics.remainingDays}</Text><Text style={{ fontSize: 10, color: T.purple, fontWeight: '700', opacity: 0.8 }}>dias</Text></View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {item.VENCIMENTO?.trim() ? (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name={vc.icon} size={12} color={vc.color} /><Text style={{ fontSize: 11.5 * fontScale, fontWeight: '800', color: vc.color }}>{vs.status === 'expired' ? `Vencido` : vs.status === 'warning' ? `${vs.days}d` : item.VENCIMENTO}</Text></View>) : <View />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="user" size={10} color={T.textMuted} /><Text style={{ fontSize: 10.5 * fontScale, fontWeight: '700', color: T.textMuted }} numberOfLines={1}>{item.ENVIADOPORQUEM || 'Sistema'}</Text></View>
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

const CARD_W = (W - 44) / 2;
const CardGrid = ({ item, T, fontScale, onPress, fifoMode, allProducts }) => {
  const GIRO = makeGiro(T);
  const VENC = makeVENC(T);
  const scale = useRef(new Animated.Value(1)).current; const liftY = useRef(new Animated.Value(0)).current; const glow = useRef(new Animated.Value(0)).current;
  const metrics = useMemo(() => {
    if (fifoMode && allProducts && item?.codig) {
      const groups = groupProductsByEAN(allProducts);
      const lotes = groups.get(item.codig);
      if (lotes && lotes.length > 0) return buildDepletionMetrics(lotes[0], true, allProducts, item.codig);
    }
    return buildDepletionMetrics(item, false);
  }, [item, fifoMode, allProducts]);
  const g = GIRO[metrics.giro] || { color: T.textSub, glow: T.bgInput, icon: 'circle', short: '—', rate: 0 };
  const vs = vencStatus(item.VENCIMENTO); const vc = VENC[vs.status];
  const isNew = isProductRecent(item.DATAENVIO);
  const isRecent = isProductLast3Days(item.DATAENVIO);
  const pi = () => Animated.parallel([Animated.spring(scale, { toValue: 0.965, tension: 180, friction: 10, useNativeDriver: false }), Animated.spring(liftY, { toValue: -5, tension: 160, friction: 10, useNativeDriver: false }), Animated.timing(glow, { toValue: 1, duration: 160, useNativeDriver: false })]).start();
  const po = () => Animated.parallel([Animated.spring(scale, { toValue: 1, tension: 190, friction: 11, useNativeDriver: false }), Animated.spring(liftY, { toValue: 0, tension: 190, friction: 13, useNativeDriver: false }), Animated.timing(glow, { toValue: 0, duration: 220, useNativeDriver: false })]).start();
  return (
    <TouchableOpacity activeOpacity={0.97} onPress={() => onPress(item)} style={{ width: CARD_W }} onPressIn={pi} onPressOut={po}>
      <Animated.View style={{ backgroundColor: T.bgCard, borderRadius: 22, overflow: 'hidden', borderWidth: 1.5, borderColor: glow.interpolate({ inputRange: [0, 1], outputRange: [T.border, g.color + '60'] }), shadowColor: g.color, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 4, transform: [{ scale }, { translateY: liftY }] }}>
        <View style={{ height: 80, backgroundColor: g.glow, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderColor: g.color + '18' }}>
          <Animated.View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [T.bgCard, g.color + '25'] }), borderWidth: 1.5, borderColor: g.color + '40', justifyContent: 'center', alignItems: 'center' }}><Feather name={g.icon} size={22} color={g.color} /></Animated.View>
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: T.bgCard, borderWidth: 1, borderColor: g.color + '30', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9 }}><Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: g.color }}>{g.short}</Text></View>
        </View>
        <View style={{ padding: 13, gap: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: vs.status === 'expired' ? T.red : vs.status === 'warning' ? T.amber : T.green, marginTop: 3, shadowColor: vs.status === 'expired' ? T.red : vs.status === 'warning' ? T.amber : T.green, shadowOpacity: 0.8, shadowRadius: 3, elevation: 2 }} /><Text style={{ fontWeight: '900', fontSize: 13 * fontScale, color: T.text, lineHeight: 17 * fontScale, flex: 1, height: 34 }} numberOfLines={2}>{String(item.produto || '').trim() || 'Sem nome'}</Text></View>
          {(isNew || isRecent) && (<View style={{ flexDirection: 'row' }}><View style={{ backgroundColor: isNew ? T.green + '20' : T.blue + '20', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: isNew ? T.green + '50' : T.blue + '50', flexDirection: 'row', alignItems: 'center', gap: 3 }}><Feather name={isNew ? "zap" : "clock"} size={8} color={isNew ? T.green : T.blue} /><Text style={{ fontSize: 8 * fontScale, fontWeight: '800', color: isNew ? T.green : T.blue }}>{isNew ? "NOVO" : "RECENTE"}</Text></View></View>)}
          <View style={{ backgroundColor: T.purpleGlow, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: T.purple + '22', alignItems: 'center' }}><Text style={{ fontSize: 9 * fontScale, fontWeight: '800', color: T.purple, textTransform: 'uppercase' }}>~{metrics.remainingQty} restantes</Text><Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.purple, marginTop: 1 }}>Ruptura {metrics.depletionDateLabel}</Text></View>
          {item.VENCIMENTO?.trim() && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: vc.glow, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: vc.color + '22' }}><Feather name={vc.icon} size={11} color={vc.color} /><Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: vc.color, flex: 1 }} numberOfLines={1}>{vs.status === 'expired' ? `Venc. há ${Math.abs(vs.days)}d` : vs.status === 'warning' ? `${vs.days}d` : item.VENCIMENTO}</Text></View>}
          {item.quantidade && item.quantidade !== '0' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.blueGlow, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 }}><Feather name="package" size={11} color={T.blue} /><Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.blue }}>{metrics.remainingQty} un</Text></View>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.tealGlow, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, marginTop: 4 }}><Feather name="user" size={11} color={T.teal} /><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.teal, flex: 1 }} numberOfLines={1}>{item.ENVIADOPORQUEM || 'Sistema'}</Text></View>
        </View>
        <View style={{ height: 4, backgroundColor: g.color }} />
      </Animated.View>
    </TouchableOpacity>
  );
};

const ActionCard = ({ icon, mat = false, color, title, desc, onPress, badge, T, fontScale = 1 }) => {
  const Ic = mat ? MaterialCommunityIcons : Feather;
  const scale = useRef(new Animated.Value(1)).current; const iconBg = useRef(new Animated.Value(0)).current;
  const pi = () => Animated.parallel([Animated.spring(scale, { toValue: 0.97, tension: 200, friction: 12, useNativeDriver: false }), Animated.timing(iconBg, { toValue: 1, duration: 120, useNativeDriver: false })]).start();
  const po = () => Animated.parallel([Animated.spring(scale, { toValue: 1, tension: 200, friction: 10, useNativeDriver: false }), Animated.timing(iconBg, { toValue: 0, duration: 200, useNativeDriver: false })]).start();
  return (<TouchableOpacity activeOpacity={0.85} onPress={onPress} onPressIn={pi} onPressOut={po}><Animated.View style={{ flexDirection: 'row', backgroundColor: T.bgCard, padding: 18, borderRadius: 20, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: iconBg.interpolate({ inputRange: [0, 1], outputRange: [T.border, color + '40'] }), transform: [{ scale }], shadowColor: T.textMuted, shadowOpacity: 0.04, elevation: 2 }}><Animated.View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: iconBg.interpolate({ inputRange: [0, 1], outputRange: [color + '14', color + '28'] }), justifyContent: 'center', alignItems: 'center', marginRight: 16 }}><Ic name={icon} size={24} color={color} /></Animated.View><View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: T.text, fontSize: 15 * fontScale, marginBottom: 4 }}>{title}</Text>{desc && <Text style={{ fontSize: 12.5 * fontScale, color: T.textSub, lineHeight: 17 }} numberOfLines={2}>{desc}</Text>}</View>{badge && <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: color + '1A', marginRight: 10 }}><Text style={{ fontSize: 11.5 * fontScale, fontWeight: '800', color }}>{badge}</Text></View>}<Feather name="chevron-right" size={18} color={T.textSub} /></Animated.View></TouchableOpacity>);
};

const TabBtn = ({ icon, label, active, onPress, T, fontScale }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const pi = () => { Animated.spring(scale, { toValue: 0.82, useNativeDriver: false }).start(); onPress?.(); };
  const po = () => Animated.spring(scale, { toValue: 1, tension: 250, friction: 10, useNativeDriver: false }).start();
  return (
    <TouchableOpacity activeOpacity={1} onPressIn={pi} onPressOut={po} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <View style={[
          { width: active ? 50 : 40, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
          active && { backgroundColor: T.blue, shadowColor: T.blue, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
        ]}>
          <Feather name={icon} size={19} color={active ? '#FFF' : T.textMuted} />
        </View>
        <Text style={{ fontSize: 10 * fontScale, fontWeight: active ? '900' : '700', color: active ? T.blue : T.textMuted, marginTop: 3, letterSpacing: 0.1 }}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const CalculatorModal = ({ visible, onClose, onResult, T, fontScale }) => {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(false);
  const appendToExpression = (value) => { setError(false); if (lastResult !== null && /[0-9]/.test(value)) { setExpression(value); setLastResult(null); setResult(''); return; } setExpression(prev => prev + value); };
  const clearAll = () => { setExpression(''); setResult(''); setLastResult(null); setError(false); };
  const backspace = () => { setError(false); setExpression(prev => prev.slice(0, -1)); };
  const calculateResult = () => { if (!expression.trim()) return; try { let expr = expression.replace(/×/g, '*').replace(/÷/g, '/'); const calcResult = new Function('return (' + expr + ')')(); if (isNaN(calcResult) || !isFinite(calcResult)) throw new Error('Resultado inválido'); const formattedResult = Math.round(calcResult * 100) / 100; setResult(String(formattedResult)); setLastResult(formattedResult); setError(false); } catch (e) { setError(true); setResult('Erro'); } };
  const handleUseResult = () => { if (result && !error && result !== 'Erro') { onResult?.(Math.floor(parseFloat(result))); onClose(); } };
  const buttons = [['7', '8', '9', '÷'], ['4', '5', '6', '×'], ['1', '2', '3', '-'], ['0', '.', '=', '+']];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 16 }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: T.bgCard, borderRadius: 32, padding: 20, borderWidth: 1, borderColor: T.border, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, elevation: 15 }}>
          <View style={{ backgroundColor: T.bgElevated, borderRadius: 24, padding: 20, marginBottom: 18 }}>
            <Text style={{ fontSize: 15 * fontScale, color: T.textMuted, textAlign: 'right', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', minHeight: 22 }}>{expression || '0'}</Text>
            <Text style={{ fontSize: 36 * fontScale, fontWeight: '900', color: error ? T.red : T.text, textAlign: 'right', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 6 }}>{result || (lastResult !== null ? String(lastResult) : '0')}</Text>
          </View>
          {buttons.map((row, rowIdx) => (<View key={rowIdx} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>{row.map((btn) => { let bgColor = T.bgInput; let textColor = T.text; let isOperator = ['÷', '×', '-', '+', '='].includes(btn); if (btn === '=') { bgColor = T.green; textColor = '#FFF'; } else if (isOperator) { bgColor = T.blueGlow; textColor = T.blue; } return (<TouchableOpacity key={btn} style={{ flex: 1, height: 58, borderRadius: 29, backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' }} onPress={() => { if (btn === '=') calculateResult(); else if (btn === 'C') clearAll(); else if (btn === '⌫') backspace(); else appendToExpression(btn); }}><Text style={{ fontSize: 22 * fontScale, fontWeight: '800', color: textColor }}>{btn}</Text></TouchableOpacity>); })}</View>))}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}><TouchableOpacity style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: T.redGlow, alignItems: 'center', justifyContent: 'center' }} onPress={clearAll}><Text style={{ fontSize: 18 * fontScale, fontWeight: '800', color: T.red }}>C</Text></TouchableOpacity><TouchableOpacity style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: T.bgInput, alignItems: 'center', justifyContent: 'center' }} onPress={backspace}><Feather name="delete" size={20} color={T.textSub} /></TouchableOpacity></View>
          <View style={{ flexDirection: 'row', gap: 10 }}><TouchableOpacity style={{ flex: 1, paddingVertical: 14, borderRadius: 18, backgroundColor: T.bgInput, alignItems: 'center' }} onPress={onClose}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.textSub }}>Cancelar</Text></TouchableOpacity><PrimaryBtn label="Usar Resultado" icon="check" onPress={handleUseResult} color={T.blue} disabled={!result || error || result === 'Erro'} style={{ flex: 1.5 }} /></View>
        </View>
      </View>
    </Modal>
  );
};

const ConfigScreen = ({ T, currentTheme, onThemeChange, fontScale, setFontScale, notifOn, setNotifOn, TAB_SAFE, onGenerateQR, onViewAuditLogs, onEnableBiometrics, biometricEnabled, onChangePassword, userData, fifoMode, setFifoMode, micSoundEnabled, setMicSoundEnabled, micVibrationEnabled, setMicVibrationEnabled, micSoundVolume, setMicSoundVolume, voiceRecognitionEnabled, setVoiceRecognitionEnabled, elevenLabsQuota, onFetchQuota }) => {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loadingPass, setLoadingPass] = useState(false);
  const [showCurrPass, setShowCurrPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfPass, setShowConfPass] = useState(false);
  const handleChangePassword = async () => {
    if (!currentPass || !newPass || !confirmPass) { AppAlert.alert('Erro', 'Preencha todos os campos.'); return; }
    if (newPass !== confirmPass) { AppAlert.alert('Erro', 'Nova senha e confirmação não coincidem.'); return; }
    if (newPass.length < 6) { AppAlert.alert('Erro', 'A nova senha deve ter pelo menos 6 caracteres.'); return; }
    setLoadingPass(true);
    const success = await onChangePassword(currentPass, newPass);
    setLoadingPass(false);
    if (success) { setShowChangePassword(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: TAB_SAFE + 40 }} showsVerticalScrollIndicator={false}>
      <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.blue, letterSpacing: 1.2, marginBottom: 4 }}>PERSONALIZAÇÃO</Text>
      <Text style={{ fontSize: 27 * fontScale, fontWeight: '900', color: T.text, letterSpacing: -0.5, marginBottom: 24 }}>Configurações</Text>
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 16, letterSpacing: 0.8 }}>Segurança</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><View style={{ flex: 1 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Login com Biometria</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Use FaceID/TouchID para acessar o app</Text></View><Switch value={biometricEnabled} onValueChange={onEnableBiometrics} trackColor={{ false: T.border, true: T.blue + '80' }} thumbColor={biometricEnabled ? T.blue : T.textMuted} /></View>
        <TouchableOpacity onPress={() => setShowChangePassword(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: T.border }}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="lock" size={20} color={T.blue} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Alterar Senha</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub }}>Atualize sua senha de acesso</Text></View><Feather name="chevron-right" size={18} color={T.textMuted} /></TouchableOpacity>
        <TouchableOpacity onPress={onViewAuditLogs} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: T.border }}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.purpleGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="file-text" size={20} color={T.purple} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Logs de Auditoria</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub }}>Ver histórico de ações do sistema</Text></View><Feather name="chevron-right" size={18} color={T.textMuted} /></TouchableOpacity>
      </View>
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 16, letterSpacing: 0.8 }}>Gerenciamento de Estoque</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View style={{ flex: 1, paddingRight: 10 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Modo FIFO</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Agrupar lotes do mesmo produto e consumir o mais antigo primeiro.</Text></View><Switch value={fifoMode} onValueChange={setFifoMode} trackColor={{ false: T.border, true: T.blue + '80' }} thumbColor={fifoMode ? T.blue : T.textMuted} /></View>
      </View>
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.8 }}>Aparência e Tema</Text>
        <Text style={{ fontSize: 12 * fontScale, color: T.textMuted, marginBottom: 16 }}>Escolha a identidade visual do app</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {Object.keys(THEMES).map(k => {
            const th = THEMES[k]; const on = currentTheme === k;
            return (
              <TouchableOpacity key={k} onPress={() => onThemeChange(k)} style={{ width: '47%', borderRadius: 18, borderWidth: on ? 2 : 1, borderColor: on ? th.blue : T.border, overflow: 'hidden', backgroundColor: th.bg }}>
                <View style={{ height: 50, flexDirection: 'row' }}>
                  <View style={{ flex: 1, backgroundColor: th.bgCard }} />
                  <View style={{ flex: 1, backgroundColor: th.blue }} />
                  <View style={{ flex: 1, backgroundColor: th.accentSoft || th.amber }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 }}>
                  <Feather name={th.icon} size={13} color={on ? th.blue : th.textSub} />
                  <Text style={{ fontSize: 12.5 * fontScale, fontWeight: on ? '900' : '700', color: th.text, flex: 1 }}>{th.name}</Text>
                  {on && <Feather name="check-circle" size={14} color={th.blue} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 16, letterSpacing: 0.8 }}>Acessibilidade</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Tamanho da Fonte</Text><Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.blue }}>{Math.round(fontScale * 100)}%</Text></View>
        <View style={{ flexDirection: 'row', gap: 10 }}>{[0.85, 1, 1.15].map(s => (<TouchableOpacity key={s} onPress={() => setFontScale(s)} style={{ flex: 1, height: 50, borderRadius: 12, backgroundColor: fontScale === s ? T.blueMid : T.bgInput, borderWidth: 1.5, borderColor: fontScale === s ? T.blue : T.border, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: 14 * s, fontWeight: '900', color: fontScale === s ? T.blue : T.textSub }}>Aa</Text></TouchableOpacity>))}</View>
      </View>
      
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 16, letterSpacing: 0.8 }}>Configurações de Microfone</Text>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Som ao Ativar Microfone</Text>
            <Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Tocar som quando o reconhecimento iniciar</Text>
          </View>
          <Switch 
            value={micSoundEnabled} 
            onValueChange={setMicSoundEnabled} 
            trackColor={{ false: T.border, true: T.blue + '80' }} 
            thumbColor={micSoundEnabled ? T.blue : T.textMuted} 
          />
        </View>

        {micSoundEnabled && (
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Volume do Som</Text>
              <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.blue }}>{Math.round(micSoundVolume * 100)}%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[0.3, 0.6, 1.0].map(v => (
                <TouchableOpacity 
                  key={v} 
                  onPress={() => setMicSoundVolume(v)} 
                  style={{ 
                    flex: 1, 
                    height: 50, 
                    borderRadius: 12, 
                    backgroundColor: micSoundVolume === v ? T.blueMid : T.bgInput, 
                    borderWidth: 1.5, 
                    borderColor: micSoundVolume === v ? T.blue : T.border, 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <MaterialCommunityIcons 
                    name={v === 0.3 ? 'volume-low' : v === 0.6 ? 'volume-medium' : 'volume-high'} 
                    size={20} 
                    color={micSoundVolume === v ? T.blue : T.textSub} 
                  />
                  <Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: micSoundVolume === v ? T.blue : T.textSub }}>
                    {v === 0.3 ? 'Baixo' : v === 0.6 ? 'Médio' : 'Alto'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: T.border, paddingTop: 16 }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Vibração ao Reconhecer</Text>
            <Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Vibrar o dispositivo quando iniciar o reconhecimento</Text>
          </View>
          <Switch 
            value={micVibrationEnabled} 
            onValueChange={setMicVibrationEnabled} 
            trackColor={{ false: T.border, true: T.blue + '80' }} 
            thumbColor={micVibrationEnabled ? T.blue : T.textMuted} 
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: T.border, paddingTop: 16, marginTop: 16 }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Assistente de Voz (Sempre Ativo)</Text>
            <Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Permite ativar o GEI.AI falando "Hey GEI" a qualquer momento</Text>
          </View>
          <Switch 
            value={voiceRecognitionEnabled} 
            onValueChange={setVoiceRecognitionEnabled} 
            trackColor={{ false: T.border, true: T.blue + '80' }} 
            thumbColor={voiceRecognitionEnabled ? T.blue : T.textMuted} 
          />
        </View>

      </View>

      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#10B981' + '30', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#10B981' + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#10B981' + '40' }}>
            <MaterialCommunityIcons name="robot-outline" size={22} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.text }}>Cotas ElevenLabs</Text>
            <Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Uso de caracteres TTS</Text>
          </View>
          <TouchableOpacity 
            onPress={onFetchQuota}
            style={{ padding: 8, backgroundColor: '#10B981' + '20', borderRadius: 10 }}
          >
            <Feather name="refresh-cw" size={18} color="#10B981" />
          </TouchableOpacity>
        </View>
        
        {elevenLabsQuota ? (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600' }}>Caracteres usados:</Text>
              <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '700' }}>{elevenLabsQuota.characterCount.toLocaleString()}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600' }}>Limite do plano:</Text>
              <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '700' }}>{elevenLabsQuota.characterLimit.toLocaleString()}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600' }}>Restantes:</Text>
              <Text style={{ fontSize: 13 * fontScale, color: '#10B981', fontWeight: '900' }}>{elevenLabsQuota.remaining.toLocaleString()}</Text>
            </View>
            <View style={{ height: 8, backgroundColor: T.bgInput, borderRadius: 8, overflow: 'hidden' }}>
              <View style={{ 
                width: `${elevenLabsQuota.percentUsed}%`, 
                height: '100%', 
                backgroundColor: parseFloat(elevenLabsQuota.percentUsed) > 90 ? T.red : parseFloat(elevenLabsQuota.percentUsed) > 70 ? T.amber : '#10B981',
                borderRadius: 8 
              }} />
            </View>
            <Text style={{ fontSize: 11 * fontScale, color: T.textMuted, marginTop: 6, textAlign: 'center' }}>
              {elevenLabsQuota.percentUsed}% usado
            </Text>
          </View>
        ) : (
          <TouchableOpacity 
            onPress={onFetchQuota}
            style={{ 
              padding: 14, 
              backgroundColor: '#10B981' + '15', 
              borderRadius: 12, 
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: '#10B981' + '30'
            }}
          >
            <Text style={{ fontSize: 13 * fontScale, color: '#10B981', fontWeight: '700' }}>
              Toque para carregar cotas
            </Text>
          </TouchableOpacity>
        )}
      </View>
      
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: T.border, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.textSub, textTransform: 'uppercase', marginBottom: 16, letterSpacing: 0.8 }}>Automação e Dados</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View style={{ flex: 1, paddingRight: 10 }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '700', color: T.text }}>Notificações de Ruptura</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Alertar quando um produto estiver próximo de acabar.</Text></View><Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ false: T.border, true: T.blue + '80' }} thumbColor={notifOn ? T.blue : T.textMuted} /></View>
      </View>
      <TouchableOpacity onPress={onGenerateQR} style={{ backgroundColor: T.purpleGlow, borderRadius: 24, padding: 20, borderWidth: 1.5, borderColor: T.purple + '50', marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.purple + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.purple + '50' }}><Feather name="smartphone" size={22} color={T.purple} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: T.text }}>Gerar QR Code de Acesso</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 1 }}>Compartilhe acesso rápido com outros dispositivos</Text></View><Feather name="chevron-right" size={20} color={T.textMuted} /></TouchableOpacity>
      <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#5865F260', marginBottom: 16 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}><View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#5865F220', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#5865F240' }}><Feather name="message-circle" size={22} color="#5865F2" /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.text }}>Notificações de Vencimento</Text><Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginTop: 2 }}>Receba alertas via Discord</Text></View></View><Text style={{ fontSize: 13 * fontScale, color: T.textSub, marginBottom: 16, lineHeight: 20 * fontScale }}>Entre no servidor do GEI.AI e seja notificado sempre que um produto estiver prestes a vencer.</Text><TouchableOpacity onPress={() => Linking.openURL('https://discord.gg/e6UEjdFHMS')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#5865F2', paddingVertical: 14, borderRadius: 16, marginBottom: 10, shadowColor: '#5865F2', shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 }}><Feather name="users" size={18} color="#FFF" /><Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: '#FFF' }}>Entrar no Servidor Discord</Text></TouchableOpacity><TouchableOpacity onPress={() => Linking.openURL('https://play.google.com/store/apps/details?id=com.discord&hl=pt_BR')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: T.bgInput, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5, borderColor: '#5865F250' }}><Feather name="download" size={16} color="#5865F2" /><Text style={{ fontSize: 14 * fontScale, fontWeight: '700', color: '#5865F2' }}>Baixar Discord (Play Store)</Text></TouchableOpacity></View>
      <Text style={{ textAlign: 'center', color: T.textMuted, fontSize: 11 * fontScale, fontWeight: '700', marginTop: 4 }}>GEI.AI v5.0 Secure · 2026</Text>
      <Modal visible={showChangePassword} transparent animationType="fade" onRequestClose={() => setShowChangePassword(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowChangePassword(false)} /><View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 24, borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 20 * fontScale, fontWeight: '900', color: T.text, marginBottom: 6 }}>Alterar Senha</Text><Text style={{ fontSize: 13 * fontScale, color: T.textSub, marginBottom: 20 }}>Digite sua senha atual e a nova senha.</Text><View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 14, marginBottom: 16, paddingRight: 12 }}><TextInput secureTextEntry={!showCurrPass} style={{ flex: 1, padding: 14, color: T.text }} placeholder="Senha atual" placeholderTextColor={T.textMuted} value={currentPass} onChangeText={setCurrentPass} /><TouchableOpacity onPress={() => setShowCurrPass(p => !p)}><Feather name={showCurrPass ? 'eye' : 'eye-off'} size={20} color={T.textSub} /></TouchableOpacity></View><View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 14, marginBottom: 16, paddingRight: 12 }}><TextInput secureTextEntry={!showNewPass} style={{ flex: 1, padding: 14, color: T.text }} placeholder="Nova senha" placeholderTextColor={T.textMuted} value={newPass} onChangeText={setNewPass} /><TouchableOpacity onPress={() => setShowNewPass(p => !p)}><Feather name={showNewPass ? 'eye' : 'eye-off'} size={20} color={T.textSub} /></TouchableOpacity></View><View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 14, marginBottom: 20, paddingRight: 12 }}><TextInput secureTextEntry={!showConfPass} style={{ flex: 1, padding: 14, color: T.text }} placeholder="Confirmar nova senha" placeholderTextColor={T.textMuted} value={confirmPass} onChangeText={setConfirmPass} /><TouchableOpacity onPress={() => setShowConfPass(p => !p)}><Feather name={showConfPass ? 'eye' : 'eye-off'} size={20} color={T.textSub} /></TouchableOpacity></View><PrimaryBtn label={loadingPass ? 'Alterando...' : 'Confirmar'} onPress={handleChangePassword} color={T.blue} disabled={loadingPass} /><TouchableOpacity onPress={() => setShowChangePassword(false)} style={{ marginTop: 16, alignSelf: 'center' }}><Text style={{ color: T.textSub }}>Cancelar</Text></TouchableOpacity></View></View></Modal>
    </ScrollView>
  );
};

const ChatScreen = ({ T, fontScale, msgs, chatTxt, setChatTxt, sendChat, sendChatVoice, busy, scrollRef, TAB_H, NAV_BAR_H, onVoiceMode, jarvisRecording, jarvisProcessing, jarvisBusy, onProgressDone, activeShelf, pinnedShelf, setPinnedShelf, shlabel, SHELF_KEYS, SHELVES, onUiAction }) => {
  const keyboardAnim = useRef(new Animated.Value(0)).current;
  const [typingDots, setTypingDots] = useState(0);
  const inputRef = useRef(null);
  const [voiceMode, setVoiceMode] = useState(false);   // true = interface Gemini Live
  const [chatRecording, setChatRecording] = useState(false);
  const [chatProcessing, setChatProcessing] = useState(false);
  const chatRecordingRef = useRef(null);
  // ── Animações da onda de voz ──────────────────────────────────────────────
  const waveAnims = useRef([...Array(5)].map(() => new Animated.Value(0.3))).current;
  const waveLoop = useRef(null);
  const orbAnim = useRef(new Animated.Value(1)).current;
  const orbLoop = useRef(null);

  const startWave = () => {
    waveAnims.forEach((a, i) => {
      const loop = Animated.loop(Animated.sequence([
        Animated.delay(i * 80),
        Animated.timing(a, { toValue: 0.9 + Math.random() * 0.1, duration: 220 + i * 30, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.25, duration: 220 + i * 30, useNativeDriver: true }),
      ]));
      loop.start();
    });
    orbLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(orbAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
      Animated.timing(orbAnim, { toValue: 0.96, duration: 600, useNativeDriver: true }),
    ]));
    orbLoop.current.start();
  };
  const stopWave = () => {
    waveAnims.forEach(a => { a.stopAnimation(); Animated.timing(a, { toValue: 0.3, duration: 200, useNativeDriver: true }).start(); });
    if (orbLoop.current) { orbLoop.current.stop(); }
    Animated.timing(orbAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };

  // ── Loop contínuo de voz (estilo Gemini Live) ────────────────────────────
  const liveActiveRef = useRef(false);   // true = loop rodando
  const liveLoopRef   = useRef(null);    // handle do timeout entre chunks
  const CHUNK_MS = 2800;                 // duração de cada chunk de gravação

  // Voice loop is managed at App level via props

  const handleMicPress = () => { if (voiceMode) setVoiceMode(false); };

  useEffect(() => {
    const onShow = e => { Animated.spring(keyboardAnim, { toValue: e.endCoordinates.height, useNativeDriver: false, tension: 65, friction: 11 }).start(); setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 80); };
    const onHide = () => { Animated.spring(keyboardAnim, { toValue: 0, useNativeDriver: false, tension: 65, friction: 11 }).start(); };
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide);
    return () => { show.remove(); hide.remove(); };
  }, [keyboardAnim, scrollRef]);

  useEffect(() => { let iv; if (busy) { iv = setInterval(() => setTypingDots(p => (p + 1) % 4), 380); } else { setTypingDots(0); } return () => clearInterval(iv); }, [busy]);
  useLayoutEffect(() => { const timer = setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 150); return () => clearTimeout(timer); }, [msgs, busy, scrollRef]);
  const handleSend = () => { if (!chatTxt.trim() || busy) return; sendChat(); inputRef.current && inputRef.current.focus(); };

  // ── MODO VOZ (Gemini Live style) ──────────────────────────────────────────
  if (voiceMode) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        {/* Header */}
        <View style={{ paddingTop: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <TouchableOpacity onPress={() => setVoiceMode(false)} style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
            <Feather name="message-circle" size={19} color={T.textSub} />
          </TouchableOpacity>
          <Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: T.text }}>GEI Live</Text>
          <View style={{ width: 42 }} />
        </View>

        {/* Histórico de mensagens compacto */}
        <ScrollView ref={scrollRef} style={{ flex: 1, paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 20, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
          {msgs.slice(-6).map((m) => (
            <View key={m.id} style={[{ marginBottom: 8 }, m.isAi ? { alignSelf: 'flex-start', maxWidth: '88%' } : { alignSelf: 'flex-end', maxWidth: '80%' }]}>
              {m.isAi
                ? <Text style={{ fontSize: 13 * fontScale, color: T.text, lineHeight: 20, fontWeight: '500', paddingLeft: 4 }}>{m.text}</Text>
                : <View style={{ backgroundColor: T.blue + '22', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 }}><Text style={{ fontSize: 13 * fontScale, color: T.blue, fontWeight: '700' }}>{m.text}</Text></View>
              }
            </View>
          ))}
          {busy && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, marginTop: 4 }}>
              {[0,1,2].map(i => <View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: T.teal, opacity: typingDots > i ? 1 : 0.25 }} />)}
              <Text style={{ fontSize: 12 * fontScale, color: T.textSub, marginLeft: 4 }}>pensando...</Text>
            </View>
          )}
        </ScrollView>

        {/* Orb central animado */}
        <View style={{ alignItems: 'center', paddingBottom: 32 + NAV_BAR_H }}>
          {/* Ondas de voz */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 60, marginBottom: 24 }}>
            {waveAnims.map((a, i) => (
              <Animated.View key={i} style={{
                width: 5, borderRadius: 3,
                height: chatRecording ? 44 : 12,
                backgroundColor: chatRecording ? T.teal : T.border,
                transform: [{ scaleY: chatRecording ? a : new Animated.Value(0.3) }],
                opacity: chatRecording ? 1 : 0.4,
              }} />
            ))}
          </View>

          {/* Orb principal — sempre ativo no modo live */}
          <TouchableOpacity onPress={handleMicPress} activeOpacity={0.85}>
            <Animated.View style={{
              width: 96, height: 96, borderRadius: 48,
              backgroundColor: jarvisBusy ? T.bgCard : jarvisProcessing ? T.amberGlow : T.tealGlow,
              borderWidth: 3,
              borderColor: jarvisBusy ? T.border : jarvisProcessing ? T.amber : T.teal,
              justifyContent: 'center', alignItems: 'center',
              transform: [{ scale: orbAnim }],
              shadowColor: jarvisBusy ? '#000' : jarvisProcessing ? T.amber : T.teal,
              shadowOpacity: 0.45,
              shadowRadius: 28,
              elevation: 18,
            }}>
              {jarvisBusy
                ? <ActivityIndicator size="large" color={T.teal} />
                : jarvisProcessing
                  ? <ActivityIndicator size="large" color={T.amber} />
                  : <Feather name="mic" size={38} color={jarvisRecording ? T.teal : T.textSub} />
              }
            </Animated.View>
          </TouchableOpacity>

          <Text style={{ fontSize: 14 * fontScale, color: T.text, fontWeight: '800', marginTop: 20, textAlign: 'center' }}>
            {jarvisBusy ? 'GEI pensando...' : jarvisProcessing ? 'Entendendo...' : jarvisRecording ? 'Ouvindo voce...' : 'Iniciando...'}
          </Text>
          <Text style={{ fontSize: 12 * fontScale, color: T.textSub, fontWeight: '600', marginTop: 4 }}>
            {jarvisBusy || jarvisProcessing ? 'Aguarde' : 'Fale naturalmente — respondo automaticamente'}
          </Text>

          <TouchableOpacity onPress={() => setVoiceMode(false)} style={{ marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 22, backgroundColor: T.redGlow, borderWidth: 1.5, borderColor: T.red + '40' }}>
            <Feather name="mic-off" size={15} color={T.red} />
            <Text style={{ fontSize: 13 * fontScale, color: T.red, fontWeight: '800' }}>Encerrar conversa</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── MODO TEXTO (padrão) ───────────────────────────────────────────────────
  const _pinAllowed = !!(activeShelf && SHELVES && SHELVES[activeShelf]);
  return (
    <Animated.View style={{ flex: 1, backgroundColor: T.bg, paddingBottom: keyboardAnim }}>
      {/* ── HEADER: prateleira atual + botão Fixar ───────────────────────── */}
      {_pinAllowed && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: T.border, backgroundColor: T.bgCard }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: pinnedShelf ? T.amberGlow : T.tealGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: (pinnedShelf ? T.amber : T.teal) + '50' }}>
            <Feather name={pinnedShelf ? 'lock' : 'layers'} size={15} color={pinnedShelf ? T.amber : T.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.textMuted, letterSpacing: 0.6 }}>{pinnedShelf ? 'PRATELEIRA FIXADA' : 'PRATELEIRA ATIVA'}</Text>
            <Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.text }} numberOfLines={1}>{shlabel ? shlabel(pinnedShelf || activeShelf) : (pinnedShelf || activeShelf)}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setPinnedShelf && setPinnedShelf(pinnedShelf ? null : activeShelf)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: pinnedShelf ? T.amber : T.bgInput, borderWidth: 1.5, borderColor: pinnedShelf ? T.amber : T.border }}>
            <Feather name={pinnedShelf ? 'unlock' : 'lock'} size={13} color={pinnedShelf ? '#FFF' : T.textSub} />
            <Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: pinnedShelf ? '#FFF' : T.textSub }}>{pinnedShelf ? 'Liberar' : 'Fixar aqui'}</Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView ref={scrollRef} style={{ flex: 1, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingTop: 16, paddingBottom: TAB_H + NAV_BAR_H + 20 }} showsVerticalScrollIndicator={false}>
        {msgs.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 36, paddingBottom: 20 }}>
            <View style={{ width: 76, height: 76, borderRadius: 26, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 18 }}>
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: T.teal, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialCommunityIcons name="robot-outline" size={28} color="#FFF" />
              </View>
            </View>
            <Text style={{ fontSize: 19 * fontScale, fontWeight: '900', color: T.text, marginBottom: 6 }}>GEI Assistant</Text>
            <Text style={{ fontSize: 13 * fontScale, color: T.textSub, textAlign: 'center', lineHeight: 20, paddingHorizontal: 30, marginBottom: 18 }}>Pergunte ou fale naturalmente. Posso cadastrar produtos, analisar estoque e muito mais.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingHorizontal: 16 }}>
              {['Produtos vencendo essa semana', 'Cadastrar um produto'].map((s, i) => (
                <TouchableOpacity key={i} onPress={() => setChatTxt(s)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: T.bgCard, borderWidth: 1, borderColor: T.border }}>
                  <Text style={{ fontSize: 12 * fontScale, fontWeight: '700', color: T.textSub }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {msgs.map((m) => (
          <View key={m.id} style={[{ marginBottom: 12 }, m.system ? { alignSelf: 'center', width: '90%' } : m.isAi ? { alignSelf: 'flex-start', maxWidth: '88%' } : { alignSelf: 'flex-end', maxWidth: '80%' }]}>
            {m.system ? (
              <View style={{ backgroundColor: T.bgInput, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: T.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Feather name="info" size={14} color={T.textSub} />
                <Text style={{ fontSize: 12 * fontScale, color: T.textSub, fontWeight: '700', textAlign: 'center' }}>{m.text}</Text>
              </View>
            ) : m.progress ? (
              <JarvisProgressBubble
                title={m.progressTitle}
                steps={m.progressSteps}
                onDone={() => onProgressDone && onProgressDone(m.id)}
                T={T}
                fontScale={fontScale}
              />
            ) : (<>
            {(() => {
              const isSuccess = m.isAi && typeof m.text === 'string' && m.text.trim().startsWith('✅');
              return (<>
            {m.isAi && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: m.thinking ? T.amberGlow : isSuccess ? (T.greenGlow || T.tealGlow) : m.autoFix ? (T.purpleGlow || T.tealGlow) : T.tealGlow, borderWidth: 1, borderColor: m.thinking ? T.amber + '60' : isSuccess ? (T.green || T.teal) + '60' : m.autoFix ? (T.purple || T.teal) + '60' : T.teal + '40', justifyContent: 'center', alignItems: 'center' }}>
                  {m.thinking
                    ? <MaterialCommunityIcons name="cog-outline" size={14} color={T.amber} />
                    : isSuccess
                      ? <Feather name="check-circle" size={14} color={T.green || T.teal} />
                    : m.autoFix
                      ? <MaterialCommunityIcons name="auto-fix" size={14} color={T.purple || T.teal} />
                      : <MaterialCommunityIcons name="robot-outline" size={14} color={T.teal} />
                  }
                </View>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: m.thinking ? T.amber : isSuccess ? (T.green || T.teal) : m.autoFix ? (T.purple || T.teal) : T.teal }}>
                  {m.thinking ? 'Corrigindo automaticamente...' : isSuccess ? 'Cadastro confirmado' : m.autoFix ? 'Correcao automatica aplicada' : 'GEI Assistant'}
                </Text>
                {m.thinking && <ActivityIndicator size="small" color={T.amber} style={{ marginLeft: 2 }} />}
              </View>
            )}
            {m.isAi
              ? <View style={{
                  backgroundColor: m.thinking ? T.amberGlow : isSuccess ? (T.greenGlow || T.tealGlow) : m.autoFix ? (T.purpleGlow || T.tealGlow) : T.bgCard,
                  borderRadius: 18, borderBottomLeftRadius: 4,
                  padding: 14,
                  borderWidth: m.thinking ? 1.5 : (isSuccess || m.autoFix) ? 1.5 : 1,
                  borderColor: m.thinking ? T.amber + '50' : isSuccess ? (T.green || T.teal) + '50' : m.autoFix ? (T.purple || T.teal) + '50' : T.border,
                }}>
                  <Text style={{ fontSize: 14 * fontScale, lineHeight: 22 * fontScale, color: m.thinking ? T.amber : isSuccess ? (T.green || T.teal) : m.autoFix ? (T.purple || T.teal) : T.text, fontWeight: m.thinking ? '600' : '500', fontFamily: m.thinking ? Platform.OS === 'ios' ? 'Menlo' : 'monospace' : undefined }}>
                    {m.text}
                  </Text>
                  {m.thinking && (
                    <View style={{ flexDirection: 'row', gap: 3, marginTop: 10 }}>
                      {[0,1,2,3].map(i => (
                        <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: T.amber, opacity: 0.2 + (i * 0.2) }} />
                      ))}
                    </View>
                  )}
                </View>
              : <View style={{ backgroundColor: T.blue, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 18, paddingVertical: 14, shadowColor: T.blue, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}><Text style={{ fontSize: 14 * fontScale, lineHeight: 22 * fontScale, color: '#FFF', fontWeight: '500' }}>{m.text}</Text></View>
            }
              </>);
            })()}
            {m.isAi && Array.isArray(m.uiParts) && m.uiParts.length > 0 && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {m.uiParts.map((up, idx) => {
                  if (up.kind === 'choice') {
                    return (
                      <View key={idx} style={{ backgroundColor: T.bgCard, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: T.border }}>
                        {up.data?.question ? <Text style={{ fontSize: 12 * fontScale, fontWeight: '800', color: T.textSub, marginBottom: 8 }}>{up.data.question}</Text> : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {(up.data?.options || []).map((opt, oi) => (
                            <TouchableOpacity key={oi} onPress={() => onUiAction && onUiAction(opt.action, opt.value)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: T.blueGlow, borderWidth: 1, borderColor: T.blue + '50' }}>
                              <Text style={{ fontSize: 12 * fontScale, fontWeight: '800', color: T.blue }}>{opt.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  }
                  if (up.kind === 'table') {
                    const cols = up.data?.columns || [];
                    const rows = up.data?.rows || [];
                    return (
                      <View key={idx} style={{ backgroundColor: T.bgCard, borderRadius: 16, padding: 10, borderWidth: 1, borderColor: T.border }}>
                        {up.data?.title ? <Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.text, marginBottom: 8 }}>{up.data.title}</Text> : null}
                        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: T.border, paddingBottom: 6, marginBottom: 4 }}>
                          {cols.map((c, ci) => <Text key={ci} style={{ flex: 1, fontSize: 11 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase' }}>{c}</Text>)}
                        </View>
                        {rows.map((r, ri) => (
                          <View key={ri} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: ri < rows.length - 1 ? 1 : 0, borderColor: T.border + '60' }}>
                            {r.map((cell, ci) => <Text key={ci} style={{ flex: 1, fontSize: 12 * fontScale, color: T.text, fontWeight: '600' }} numberOfLines={2}>{String(cell)}</Text>)}
                          </View>
                        ))}
                      </View>
                    );
                  }
                  if (up.kind === 'list') {
                    return (
                      <View key={idx} style={{ backgroundColor: T.bgCard, borderRadius: 16, padding: 10, borderWidth: 1, borderColor: T.border, gap: 6 }}>
                        {up.data?.title ? <Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.text, marginBottom: 4 }}>{up.data.title}</Text> : null}
                        {(up.data?.items || []).map((it, ii) => (
                          <View key={ii} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center' }}>
                              <Feather name={it.icon || 'circle'} size={14} color={T.teal} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.text }} numberOfLines={1}>{it.title}</Text>
                              {it.subtitle ? <Text style={{ fontSize: 11 * fontScale, color: T.textSub, fontWeight: '600' }} numberOfLines={1}>{it.subtitle}</Text> : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  }
                  return null;
                })}
              </View>
            )}
            </>)}
          </View>
        ))}
        {busy && (
          <View style={{ marginBottom: 12, alignSelf: 'flex-start', maxWidth: '70%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: T.tealGlow, borderWidth: 1, borderColor: T.teal + '40', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialCommunityIcons name="robot-outline" size={14} color={T.teal} />
              </View>
              <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.teal }}>GEI Assistant</Text>
            </View>
            <View style={{ backgroundColor: T.bgCard, borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 18, paddingVertical: 16, borderWidth: 1, borderColor: T.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="small" color={T.teal} />
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600' }}>Digitando</Text>
              <View style={{ flexDirection: 'row', gap: 3 }}>{[0,1,2].map(i => <View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: T.teal, opacity: typingDots > i ? 1 : 0.2 }} />)}</View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Barra de input — redesenhada com cantos mais suaves e contraste de foco */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, gap: 8, backgroundColor: T.bgCard, borderTopLeftRadius: 22, borderTopRightRadius: 22, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 4 }}>
        <TouchableOpacity onPress={() => setVoiceMode(true)} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center' }}>
          <Feather name="mic" size={19} color={T.teal} />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={{ flex: 1, backgroundColor: T.bgInput, borderRadius: 23, paddingHorizontal: 18, paddingVertical: 13, color: T.text, fontSize: 15 * fontScale, maxHeight: 120, lineHeight: 20 }}
          placeholder="Pergunte ou peça para cadastrar..."
          placeholderTextColor={T.textSub}
          value={chatTxt}
          onChangeText={setChatTxt}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
          blurOnSubmit={false}
          editable={!busy}
        />
        <TouchableOpacity onPress={handleSend} disabled={busy || !chatTxt.trim()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: chatTxt.trim() && !busy ? T.blue : T.bgInput, justifyContent: 'center', alignItems: 'center', shadowColor: T.blue, shadowOpacity: chatTxt.trim() && !busy ? 0.35 : 0, shadowRadius: 8, elevation: chatTxt.trim() && !busy ? 4 : 0 }}>
          <Feather name="send" size={19} color={chatTxt.trim() && !busy ? '#FFF' : T.textSub} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const CadastroScreen = ({ T, fontScale, perf, cadastroShelf, setCadastroShelf, activeShelf, prodName, setProdName, validade, setValidade, wStep, setWStep, nextStep, saveProduct, TAB_SAFE, isCoord, isDeposito, SHELF_KEYS, shlabel, shelfPalette, showErr }) => {
  const stepAnim = useRef(new Animated.Value(1)).current;
  const inputRef = useRef(null);
  const [shakeAnim] = useState(new Animated.Value(0));
  const [showPreview, setShowPreview] = useState(false);
  const fmtDate = v => { const c = v.replace(/\D/g, ''); if (c.length <= 2) { setValidade(c); return; } if (c.length <= 4) { setValidade(`${c.slice(0, 2)}/${c.slice(2)}`); return; } const formatted = `${c.slice(0, 2)}/${c.slice(2, 4)}/${c.slice(4, 8)}`; setValidade(formatted); if (formatted.length === 10 && isValidDate(formatted)) { Keyboard.dismiss(); } };
  const animateStep = (fn) => { Animated.sequence([Animated.timing(stepAnim, { toValue: 0.94, duration: 100, useNativeDriver: false }), Animated.timing(stepAnim, { toValue: 1, duration: 160, useNativeDriver: false })]).start(); fn(); };
    const getTargetShelf = () => (isCoord(perf) || isDeposito(perf)) && cadastroShelf ? cadastroShelf : activeShelf;
  const STEPS = ['Nome', 'Validade'];
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, [wStep]);
  const handleNext = () => { if (wStep === 1 && !prodName.trim()) { shake(); showErr('O nome do produto é obrigatório.'); return; } if (wStep === 2) { if (!validade) { shake(); showErr('A data de validade é obrigatória.'); return; } if (!isValidDate(validade)) { shake(); showErr('Data inválida! Use o formato DD/MM/AAAA e uma data real.'); return; } } animateStep(() => nextStep()); };
  const shake = () => { Animated.sequence([Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }), Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }), Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }), Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true })]).start(); };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: T.bg }}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: shakeAnim }] }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: TAB_SAFE + 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.blue, letterSpacing: 1.2, marginBottom: 2 }}>CADASTRO RÁPIDO</Text>
              <Text style={{ fontSize: 27 * fontScale, fontWeight: '900', color: T.text, letterSpacing: -0.5 }}>Novo Produto</Text>
            </View>
            <TouchableOpacity onPress={() => setShowPreview(!showPreview)} style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: showPreview ? T.blueGlow : T.bgInput, borderWidth: 1, borderColor: showPreview ? T.blue + '50' : T.border, justifyContent: 'center', alignItems: 'center' }}><Feather name={showPreview ? 'eye-off' : 'eye'} size={19} color={showPreview ? T.blue : T.textSub} /></TouchableOpacity>
          </View>
          {(isCoord(perf) || isDeposito(perf)) && (<View style={{ backgroundColor: T.bgCard, borderRadius: 20, padding: 16, marginTop: 18, marginBottom: 4, borderWidth: 1.5, borderColor: T.orange + '40' }}><Text style={{ fontSize: 12 * fontScale, fontWeight: '800', color: T.orange, textTransform: 'uppercase', marginBottom: 12 }}>Prateleira de Destino</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{SHELF_KEYS.map(k => { const on = (cadastroShelf || activeShelf) === k; const pal = shelfPalette(T, k); return (<TouchableOpacity key={k} style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border }, on && { backgroundColor: pal.glow, borderColor: pal.accent + '70' }]} onPress={() => setCadastroShelf(k)}><Feather name={pal.icon} size={13} color={on ? pal.accent : T.textSub} /><Text style={[{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }, on && { color: pal.accent, fontWeight: '900' }]}>{shlabel(k)}</Text></TouchableOpacity>); })}</View></View>)}
          {/* ── Stepper redesenhado: trilha conectada com nós numerados ── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 26, marginBottom: 22, paddingHorizontal: 4 }}>
            {STEPS.map((s, i) => {
              const idx = i + 1; const done = wStep > idx; const active = wStep === idx;
              return (
                <React.Fragment key={s}>
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: done ? T.blue : active ? T.bgCard : T.bgInput, borderWidth: active ? 2 : 0, borderColor: T.blue, justifyContent: 'center', alignItems: 'center' }}>
                      {done ? <Feather name="check" size={15} color="#FFF" /> : <Text style={{ fontSize: 13, fontWeight: '900', color: active ? T.blue : T.textMuted }}>{idx}</Text>}
                    </View>
                    <Text style={{ fontSize: 10 * fontScale, fontWeight: active ? '900' : '700', color: active ? T.blue : T.textMuted }}>{s}</Text>
                  </View>
                  {i < STEPS.length - 1 && <View style={{ flex: 1, height: 2, backgroundColor: wStep > idx ? T.blue : T.border, marginHorizontal: 6, marginBottom: 16, borderRadius: 1 }} />}
                </React.Fragment>
              );
            })}
          </View>
          <Animated.View style={{ backgroundColor: T.bgCard, borderRadius: 26, padding: 22, borderWidth: 1, borderColor: T.border, shadowColor: T.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 3, opacity: stepAnim }}>
            {wStep === 1 && (<><View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}><View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="tag" size={22} color={T.blue} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>Qual é o produto?</Text><Text style={{ fontSize: 12.5 * fontScale, color: T.textSub, fontWeight: '600', marginTop: 2 }}>Digite o nome impresso na embalagem</Text></View></View><TextInput ref={inputRef} style={{ backgroundColor: T.bgInput, borderWidth: 2, borderColor: T.border, padding: 18, borderRadius: 18, fontSize: 16 * fontScale, color: T.text, fontWeight: '700', minHeight: 80, textAlignVertical: 'top' }} placeholder="Ex: Leite Integral Parmalat 1L" placeholderTextColor={T.textSub} value={prodName} onChangeText={setProdName} multiline autoCorrect />{prodName.length > 0 && (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 12, backgroundColor: T.blueGlow, borderRadius: 12, borderWidth: 1, borderColor: T.blue + '30' }}><Feather name="check-circle" size={14} color={T.blue} /><Text style={{ fontSize: 12 * fontScale, color: T.blue, fontWeight: '700', flex: 1 }} numberOfLines={1}>{prodName}</Text></View>)}</>)}
            {wStep === 2 && (<><View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}><View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: T.amberGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="calendar" size={22} color={T.amber} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>Validade do produto</Text><Text style={{ fontSize: 12.5 * fontScale, color: T.textSub, fontWeight: '600', marginTop: 2 }}>Data de vencimento na embalagem</Text></View></View><TextInput ref={inputRef} style={{ backgroundColor: T.bgInput, borderWidth: 2, borderColor: T.border, padding: 20, borderRadius: 18, fontSize: 28 * fontScale, color: T.text, textAlign: 'center', letterSpacing: 4, fontWeight: '900' }} keyboardType="numeric" placeholder="DD/MM/AAAA" placeholderTextColor={T.textSub} value={validade} onChangeText={fmtDate} maxLength={10} autoFocus />{validade.length === 10 && (isValidDate(validade) ? (() => { const vs = vencStatus(validade); const colors = { expired: T.red, warning: T.amber, ok: T.green, unknown: T.textMuted }; const icons = { expired: 'alert-circle', warning: 'alert-triangle', ok: 'check-circle', unknown: 'clock' }; const labels = { expired: `Produto já vencido!`, warning: `Vence em ${vs.days} dia${vs.days !== 1 ? 's' : ''}`, ok: `Válido até ${validade}`, unknown: 'Data inválida' }; return (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: colors[vs.status] + '18', borderRadius: 12, borderWidth: 1, borderColor: colors[vs.status] + '40' }}><Feather name={icons[vs.status]} size={16} color={colors[vs.status]} /><Text style={{ fontSize: 13 * fontScale, color: colors[vs.status], fontWeight: '800' }}>{labels[vs.status]}</Text></View>); })() : (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: T.redGlow, borderRadius: 12, borderWidth: 1, borderColor: T.red + '40' }}><Feather name="alert-circle" size={16} color={T.red} /><Text style={{ fontSize: 13 * fontScale, color: T.red, fontWeight: '800' }}>Data inválida! Use o formato DD/MM/AAAA e uma data real.</Text></View>))}</>)}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 26 }}>{wStep > 1 && (<TouchableOpacity style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border, justifyContent: 'center', alignItems: 'center' }} onPress={() => animateStep(() => setWStep(p => p - 1))}><Feather name="arrow-left" size={20} color={T.textSub} /></TouchableOpacity>)}<PrimaryBtn label={wStep < 2 ? 'Avançar' : 'Finalizar Cadastro'} icon={wStep < 2 ? 'arrow-right' : 'check'} onPress={handleNext} style={{ flex: 1, height: 54 }} color={T.blue} fontScale={fontScale} /></View>
          </Animated.View>
          {showPreview && (prodName || validade) && (<View style={{ marginTop: 20, backgroundColor: T.bgCard, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Resumo do Cadastro</Text>{[{ label: 'Produto', val: prodName, icon: 'tag', c: T.blue }, { label: 'Validade', val: validade, icon: 'calendar', c: T.amber }, { label: 'Destino', val: shlabel(getTargetShelf?.() || cadastroShelf || activeShelf), icon: 'layers', c: T.orange }].filter(i => i.val).map(i => (<View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderColor: T.border }}><Feather name={i.icon} size={13} color={i.c} /><Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: T.textMuted, width: 64 }}>{i.label}</Text><Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.text, flex: 1 }} numberOfLines={1}>{i.val}</Text></View>))}</View>)}
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

// ─── JARVIS PROGRESS BUBBLE — análise "inteligente" inline no chat ──────────
// Em vez de um Modal fullscreen (que fica escondido se o usuario sair da aba
// de chat), esta versão renderiza como uma bolha de mensagem dentro da
// própria lista de mensagens — sempre visível enquanto a IA "trabalha".
const JarvisProgressBubble = ({ steps, title, onDone, T, fontScale, autoCloseMs = 650 }) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const progAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const timersRef = useRef([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const STEPS = steps && steps.length ? steps : ['Analisando dados...', 'Verificando inconsistencias...', 'Aplicando correcoes...', 'Concluido.'];

  useEffect(() => {
    setStepIdx(0);
    setProgress(0);
    progAnim.setValue(0);

    const spin = Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    spin.start();

    const totalSteps = STEPS.length;
    const stepDuration = Math.max(420, Math.floor(1400 / totalSteps));
    timersRef.current = [];
    for (let i = 0; i < totalSteps; i++) {
      const t = setTimeout(() => {
        setStepIdx(i);
        const target = Math.round(((i + 1) / totalSteps) * 100);
        setProgress(target);
        Animated.timing(progAnim, { toValue: target, duration: stepDuration - 80, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      }, i * stepDuration);
      timersRef.current.push(t);
    }
    const doneTimer = setTimeout(() => {
      spin.stop();
      if (onDoneRef.current) onDoneRef.current();
    }, totalSteps * stepDuration + autoCloseMs);
    timersRef.current.push(doneTimer);

    return () => { timersRef.current.forEach(clearTimeout); spin.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const widthInterp = progAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={{
      backgroundColor: T.tealGlow, borderRadius: 18, borderBottomLeftRadius: 4,
      padding: 14, borderWidth: 1.5, borderColor: T.teal + '50',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Animated.View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: T.bgCard, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.teal + '50', transform: [{ rotate: spinDeg }] }}>
          <MaterialCommunityIcons name="robot-outline" size={16} color={T.teal} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: T.teal }}>{title || 'GEI Assistant analisando'}</Text>
          <Text style={{ fontSize: 12 * fontScale, color: T.text, fontWeight: '700', marginTop: 2 }}>{STEPS[stepIdx]}</Text>
        </View>
        <Text style={{ fontSize: 11 * fontScale, color: T.teal, fontWeight: '900' }}>{progress}%</Text>
      </View>
      <View style={{ width: '100%', height: 6, borderRadius: 4, backgroundColor: T.bgInput, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
        <Animated.View style={{ height: '100%', borderRadius: 4, backgroundColor: T.teal, width: widthInterp }} />
      </View>
    </View>
  );
};

const ProductSourceModal = ({ visible, sources, onSelect, onClose, T, fontScale }) => {
  const [selected, setSelected] = useState(0);
  const [thinkingPhase, setThinkingPhase] = useState(true);
  const [thinkingSeconds, setThinkingSeconds] = useState(3);
  const [showFailed, setShowFailed] = useState(false);
  const slideA = useRef(new Animated.Value(WIN.height)).current;
  const opacA = useRef(new Animated.Value(0)).current;
  const pulseThinkA = useRef(new Animated.Value(1)).current;
  const rotateThinkA = useRef(new Animated.Value(0)).current;
  const thinkingTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const pulseLoopRef = useRef(null);
  const rotateLoopRef = useRef(null);

  const sourceColors = (src) => {
    const map = {
      ia: { color: T.purple, glow: T.purpleGlow, icon: 'cpu', label: 'GEI.IA' },
      groq: { color: T.orange, glow: T.orangeGlow, icon: 'zap', label: 'GEI-GROK' },
      bluesoft: { color: T.blue, glow: T.blueGlow, icon: 'database', label: 'Bluesoft' },
      openfoodfacts: { color: T.teal, glow: T.tealGlow, icon: 'globe', label: 'Open Food Facts' },
      manual: { color: T.textSub, glow: T.bgInput, icon: 'alert-circle', label: 'Manual' },
      error: { color: T.red, glow: T.redGlow, icon: 'alert-triangle', label: 'Erro na Fonte' },
    };
    return map[src] || { color: T.blue, glow: T.blueGlow, icon: 'info', label: 'Desconhecido' };
  };

  useEffect(() => {
    if (visible) {
      setThinkingPhase(true);
      setThinkingSeconds(3);
      setShowFailed(false);
      const offIdx = sources.findIndex(s => s.status === 'success' && s.source === 'openfoodfacts');
      const firstValid = sources.findIndex(s => s.status === 'success');
      const preferred = offIdx !== -1 ? offIdx : (firstValid !== -1 ? firstValid : 0);
      setSelected(preferred);
      slideA.setValue(WIN.height); opacA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 52, friction: 11, useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 1, duration: 280, useNativeDriver: false }),
      ]).start();
      pulseLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(pulseThinkA, { toValue: 1.18, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseThinkA, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]));
      pulseLoopRef.current.start();
      rotateThinkA.setValue(0);
      rotateLoopRef.current = Animated.loop(Animated.timing(rotateThinkA, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: false }));
      rotateLoopRef.current.start();
      let secs = 3;
      countdownRef.current = setInterval(() => { secs = secs - 1; setThinkingSeconds(secs); if (secs <= 0) { clearInterval(countdownRef.current); countdownRef.current = null; } }, 1000);
      thinkingTimerRef.current = setTimeout(() => {
        setThinkingPhase(false);
        if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
        if (rotateLoopRef.current) { rotateLoopRef.current.stop(); rotateLoopRef.current = null; }
        pulseThinkA.setValue(1);
      }, 3000);
    } else {
      if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
      if (rotateLoopRef.current) { rotateLoopRef.current.stop(); rotateLoopRef.current = null; }
      Animated.parallel([
        Animated.timing(slideA, { toValue: WIN.height, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]).start();
    }
    return () => {
      if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, [visible, sources, slideA, opacA, pulseThinkA, rotateThinkA]);

  if (!visible || !sources?.length) return null;

  const visibleSources = sources.filter(s => s.status === 'success');
  const failedSources = sources.filter(s => s.status !== 'success');

  const handleConfirm = () => {
    const item = visibleSources[selected];
    if (!item || item.status === 'error') {
      AppAlert.alert('Fonte com erro', 'Não é possível usar uma fonte que falhou na análise.');
      return;
    }
    onSelect({ nome: item.nome, giro: item.giro });
  };

  const confidenceBadge = (c) => {
    if (c >= 85) return { label: 'Alta confiança', color: T.green };
    if (c >= 60) return { label: 'Média confiança', color: T.amber };
    return { label: 'Baixa confiança', color: T.red };
  };

  const spinInterp = rotateThinkA.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const AI_SOURCES_LIST = [
    { label: 'GEI.IA Gemini', icon: 'cpu', color: T.purple },
    { label: 'Bluesoft Cosmos', icon: 'database', color: T.blue },
    { label: 'GEI-SUPER', icon: 'star', color: T.amber },
    { label: 'GEI-LOGIC', icon: 'zap', color: T.orange },
    { label: 'Open Food Facts', icon: 'globe', color: T.teal },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', opacity: opacA }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: T.bgCard, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingBottom: 28 + NAV_BAR_H, borderTopWidth: 2, borderColor: T.blue + '60', maxHeight: WIN.height * 0.99, transform: [{ translateY: slideA }], shadowColor: '#000', shadowOffset: { width: 0, height: -12 }, shadowOpacity: 0.5, shadowRadius: 30, elevation: 28 }}>
          <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 4 }}><View style={{ width: 48, height: 5, backgroundColor: T.blue + '60', borderRadius: 3 }} /></View>
          {thinkingPhase ? (
            <View style={{ padding: 28, alignItems: 'center', minHeight: 400, justifyContent: 'center' }}>
              <Animated.View style={{ width: 108, height: 108, borderRadius: 54, backgroundColor: T.purple + '16', borderWidth: 3, borderColor: T.purple + '55', justifyContent: 'center', alignItems: 'center', marginBottom: 26, shadowColor: T.purple, shadowOpacity: 0.45, shadowRadius: 24, elevation: 14, transform: [{ scale: pulseThinkA }] }}>
                <Animated.View style={{ transform: [{ rotate: spinInterp }] }}><MaterialCommunityIcons name="brain" size={54} color={T.purple} /></Animated.View>
              </Animated.View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.purple + '15', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginBottom: 14, borderWidth: 1, borderColor: T.purple + '30' }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.purple }} /><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.purple, letterSpacing: 1.4, textTransform: 'uppercase' }}>GEI.AI · Processando</Text></View>
              <Text style={{ fontSize: 21 * fontScale, fontWeight: '900', color: T.text, marginBottom: 8, textAlign: 'center', letterSpacing: -0.3 }}>IA está pensando...</Text>
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', textAlign: 'center', lineHeight: 20, marginBottom: 26, paddingHorizontal: 24 }}>O Gemini está aprimorando as descrições encontradas na Bluesoft e Open Food Facts para você</Text>
              <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: T.bgElevated, borderWidth: 3.5, borderColor: thinkingSeconds <= 1 ? T.green + '80' : T.blue + '60', justifyContent: 'center', alignItems: 'center', marginBottom: 24, shadowColor: T.blue, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}>
                <Text style={{ fontSize: 30 * fontScale, fontWeight: '900', color: thinkingSeconds <= 1 ? T.green : T.blue, lineHeight: 34 * fontScale }}>{Math.max(0, thinkingSeconds)}</Text>
                <Text style={{ fontSize: 9 * fontScale, color: T.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>seg</Text>
              </View>
              <View style={{ width: '100%', height: 7, backgroundColor: T.border, borderRadius: 4, overflow: 'hidden', marginBottom: 26 }}>
                <View style={{ height: '100%', borderRadius: 4, backgroundColor: thinkingSeconds <= 1 ? T.green : T.purple, width: `${Math.min(100, ((3 - Math.max(0, thinkingSeconds)) / 3) * 100)}%` }} />
              </View>
              <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Consultando {AI_SOURCES_LIST.length} fontes</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>{AI_SOURCES_LIST.map((ai, idx) => (<View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, backgroundColor: ai.color + '12', borderColor: ai.color + '35' }}><ActivityIndicator size="small" color={ai.color} style={{ transform: [{ scale: 0.65 }] }} /><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: ai.color }}>{ai.label}</Text></View>))}</View>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.blue + '50' }}><MaterialCommunityIcons name="text-search" size={24} color={T.blue} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 0.8 }}>Fontes encontradas</Text><Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>Selecione o nome do produto</Text></View>
              </View>
              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', marginBottom: 20, lineHeight: 19 }}>{visibleSources.length > 0 ? `Consultamos ${sources.length} fonte${sources.length !== 1 ? 's' : ''}. ${visibleSources.length} responderam com sucesso. Escolha o melhor nome:` : 'Nenhuma fonte retornou resultado. Tente novamente.'}</Text>
              {visibleSources.length === 0 && (<View style={{ alignItems: 'center', paddingVertical: 32 }}><Feather name="alert-circle" size={40} color={T.red} /><Text style={{ color: T.textSub, marginTop: 12, fontSize: 14 * fontScale, fontWeight: '700', textAlign: 'center' }}>Todas as fontes falharam. Tente escanear novamente.</Text></View>)}
              <View style={{ gap: 12, marginBottom: 16 }}>{visibleSources.map((src, i) => { const pal = sourceColors(src.status === 'error' ? 'error' : src.source); const conf = confidenceBadge(src.confianca); const isSelected = selected === i; return (<TouchableOpacity key={`${src.source}-${i}`} activeOpacity={0.85} onPress={() => setSelected(i)}><Animated.View style={{ borderRadius: 22, borderWidth: isSelected ? 2.5 : 1.5, borderColor: isSelected ? pal.color : T.border, backgroundColor: isSelected ? pal.glow : T.bgElevated, overflow: 'hidden' }}>{isSelected && <View style={{ height: 3, backgroundColor: pal.color }} />}<View style={{ padding: 16 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}><View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: isSelected ? pal.color + '25' : T.bgCard, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: isSelected ? pal.color + '50' : T.border }}><Feather name={pal.icon} size={16} color={isSelected ? pal.color : T.textSub} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: isSelected ? pal.color : T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{src.sourceLabel}</Text>{src.source === 'openfoodfacts' && <Text style={{ fontSize: 9.5 * fontScale, fontWeight: '800', color: T.green }}>⭐ Prioritário</Text>}</View>{src.status !== 'error' && (<View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: conf.color + '18', borderWidth: 1, borderColor: conf.color + '40' }}><Text style={{ fontSize: 9.5 * fontScale, fontWeight: '900', color: conf.color }}>{src.confianca}%</Text></View>)}{isSelected ? (<View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: pal.color, justifyContent: 'center', alignItems: 'center' }}><Feather name="check" size={14} color="#FFF" /></View>) : (<View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: T.bgCard, borderWidth: 1.5, borderColor: T.border }} />)}</View><View style={{ backgroundColor: isSelected ? pal.color + '12' : T.bgCard, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: isSelected ? pal.color + '30' : T.border }}><Text style={{ fontSize: 15 * fontScale, fontWeight: '800', color: isSelected ? T.text : T.textSub, lineHeight: 21 * fontScale }}>{src.nome}</Text>{src.status === 'error' && <Text style={{ fontSize: 12 * fontScale, fontWeight: '700', color: T.red, marginTop: 5 }}>Motivo: {src.error}</Text>}{src.categoria ? <Text style={{ fontSize: 10.5 * fontScale, fontWeight: '700', color: T.textMuted, marginTop: 5 }}>Categoria: {src.categoria}</Text> : null}</View>{src.giro && src.status !== 'error' && (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}><Feather name="refresh-cw" size={11} color={T.textMuted} /><Text style={{ fontSize: 11 * fontScale, color: T.textMuted, fontWeight: '700' }}>Giro sugerido: <Text style={{ color: isSelected ? pal.color : T.textSub, fontWeight: '900' }}>{src.giro}</Text></Text></View>)}</View></Animated.View></TouchableOpacity>); })}</View>
              {failedSources.length > 0 && (<><TouchableOpacity onPress={() => setShowFailed(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5, borderColor: T.textMuted + '45', backgroundColor: T.bgElevated, marginBottom: showFailed ? 12 : 20 }} activeOpacity={0.75}><Feather name={showFailed ? 'chevron-up' : 'chevron-down'} size={16} color={T.textMuted} /><Text style={{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }}>{showFailed ? 'Ocultar resultados' : 'Visualizar mais resultados'}</Text><View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: T.red + '18', borderWidth: 1, borderColor: T.red + '35' }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.red }}>{failedSources.length} sem resposta</Text></View></TouchableOpacity>{showFailed && (<View style={{ gap: 8, marginBottom: 20 }}>{failedSources.map((src, i) => (<View key={`failed-${i}`} style={{ borderRadius: 16, borderWidth: 1, borderColor: T.red + '28', backgroundColor: T.redGlow, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: T.red + '18', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.red + '38' }}><Feather name="alert-triangle" size={15} color={T.red} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.red, textTransform: 'uppercase', letterSpacing: 0.5 }}>{src.sourceLabel}</Text><Text style={{ fontSize: 11 * fontScale, color: T.textSub, fontWeight: '600', marginTop: 2 }} numberOfLines={2}>{src.error || 'Fonte não respondeu nesta consulta'}</Text></View></View>))}</View>)}</>)}
              {visibleSources.length > 0 && (<TouchableOpacity onPress={handleConfirm} style={{ height: 54, borderRadius: 16, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, shadowColor: T.blue, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6, marginBottom: 8 }}><Feather name="check-circle" size={18} color="#FFF" /><Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: '#FFF' }}>Usar este nome</Text></TouchableOpacity>)}
              <TouchableOpacity onPress={onClose} style={{ height: 48, borderRadius: 14, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '700', color: T.textSub }}>Digitar manualmente</Text></TouchableOpacity>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// 🆕 NOVO COMPONENTE: EXPIRY ANALYSIS MODAL (ANÁLISE DE VENCIMENTOS POR MÊS)
const ExpiryAnalysisModal = ({ visible, onClose, products, T, fontScale }) => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const slideA = useRef(new Animated.Value(WIN.height)).current;
  const opacA = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Agrupa produtos por mês/ano (próximos 30 dias)
  const expiryGroups = useMemo(() => {
    const now = today();
    const thirtyDaysLater = addDays(now, 30);
    const filtered = products.filter(prod => {
      const dt = parseDate(prod.VENCIMENTO);
      if (!dt) return false;
      const diff = diffDays(dt, now);
      return diff >= 0 && diff <= 30;
    });
    const groups = new Map();
    filtered.forEach(prod => {
      const dt = parseDate(prod.VENCIMENTO);
      if (!dt) return;
      const monthKey = `${dt.getFullYear()}-${dt.getMonth() + 1}`;
      const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(dt);
      if (!groups.has(monthKey)) {
        groups.set(monthKey, { monthName, products: [], total: 0 });
      }
      groups.get(monthKey).products.push(prod);
      groups.get(monthKey).total++;
    });
    // Ordenar por data crescente
    const sorted = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([key, value]) => ({ key, ...value }));
  }, [products]);

  const totalItems = expiryGroups.reduce((acc, g) => acc + g.total, 0);

  useEffect(() => {
    if (visible) {
      slideA.setValue(WIN.height);
      opacA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 52, friction: 11, useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 1, duration: 280, useNativeDriver: false }),
      ]).start();
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    } else {
      Animated.parallel([
        Animated.timing(slideA, { toValue: WIN.height, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]).start();
      setSelectedMonth(null);
    }
  }, [visible, fadeAnim, opacA, slideA]);

  const getMonthColor = (daysUntilExpiry) => {
    if (daysUntilExpiry <= 7) return T.red;
    if (daysUntilExpiry <= 15) return T.amber;
    return T.green;
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', opacity: opacA }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: T.bgCard,
          borderTopLeftRadius: 32, borderTopRightRadius: 32,
          paddingBottom: 20 + NAV_BAR_H,
          borderTopWidth: 2.5, borderColor: T.orange + '80',
          maxHeight: WIN.height * 0.95,
          transform: [{ translateY: slideA }],
          shadowColor: '#000', shadowOffset: { width: 0, height: -10 },
          shadowOpacity: 0.35, shadowRadius: 28, elevation: 28,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 2 }}>
            <View style={{ width: 48, height: 5, backgroundColor: T.orange + '80', borderRadius: 3 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderColor: T.border }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.orangeGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: T.orange + '60', marginRight: 12 }}>
              <Feather name="calendar" size={24} color={T.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: T.orange, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 2 }}>Previsão de Vencimentos</Text>
              <Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text, letterSpacing: -0.4 }}>Próximos 30 dias</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}>
              <Feather name="x" size={17} color={T.textSub} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
            {totalItems === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Feather name="check-circle" size={60} color={T.green} />
                <Text style={{ fontSize: 16 * fontScale, fontWeight: '900', color: T.text, marginTop: 16 }}>Nenhum produto vence nos próximos 30 dias</Text>
                <Text style={{ fontSize: 13 * fontScale, color: T.textSub, marginTop: 8, textAlign: 'center' }}>Todos os produtos estão dentro do prazo de validade.</Text>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 13 * fontScale, color: T.textSub, marginBottom: 16, fontWeight: '600' }}>
                  📊 {totalItems} produto{totalItems !== 1 ? 's' : ''} vence{totalItems !== 1 ? 'm' : ''} nos próximos 30 dias
                </Text>
                <Animated.View style={{ opacity: fadeAnim }}>
                  {expiryGroups.map(group => {
                    const monthDate = parseDate(`01/${group.key.split('-')[1]}/${group.key.split('-')[0]}`);
                    const daysToFirstExpiry = monthDate ? diffDays(monthDate, today()) : 0;
                    const urgency = daysToFirstExpiry <= 7 ? 'critical' : daysToFirstExpiry <= 15 ? 'warning' : 'normal';
                    const urgencyColor = urgency === 'critical' ? T.red : urgency === 'warning' ? T.amber : T.blue;
                    return (
                      <TouchableOpacity key={group.key} activeOpacity={0.8} onPress={() => setSelectedMonth(selectedMonth?.key === group.key ? null : group)}>
                        <Animated.View style={{
                          backgroundColor: T.bgElevated,
                          borderRadius: 20,
                          marginBottom: 12,
                          borderWidth: 2,
                          borderColor: selectedMonth?.key === group.key ? urgencyColor : T.border,
                          overflow: 'hidden',
                        }}>
                          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: urgencyColor + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: urgencyColor + '50' }}>
                                <Text style={{ fontSize: 20, fontWeight: '900', color: urgencyColor }}>{group.key.split('-')[1]}</Text>
                              </View>
                              <View>
                                <Text style={{ fontSize: 16 * fontScale, fontWeight: '900', color: T.text }}>{group.monthName}</Text>
                                <Text style={{ fontSize: 12 * fontScale, color: T.textMuted, fontWeight: '600' }}>{group.total} produto{group.total !== 1 ? 's' : ''}</Text>
                              </View>
                            </View>
                            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: urgencyColor + '20', borderWidth: 1, borderColor: urgencyColor + '50' }}>
                              <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: urgencyColor }}>
                                {urgency === 'critical' ? 'URGENTE' : urgency === 'warning' ? 'ATENÇÃO' : 'NORMAL'}
                              </Text>
                            </View>
                          </View>
                          <Animated.View style={{ maxHeight: selectedMonth?.key === group.key ? 400 : 0, overflow: 'hidden' }}>
                            <View style={{ borderTopWidth: 1, borderColor: T.border, paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
                              {group.products.map(prod => {
                                const dt = parseDate(prod.VENCIMENTO);
                                const days = dt ? diffDays(dt, today()) : 0;
                                const barColor = getMonthColor(days);
                                return (
                                  <View key={prod.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.text }} numberOfLines={1}>
                                        {prod.produto || 'Produto sem nome'}
                                      </Text>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                        <Feather name="alert-triangle" size={12} color={barColor} />
                                        <Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: barColor }}>
                                          {days <= 0 ? 'Vence hoje' : `Vence em ${days} dia${days !== 1 ? 's' : ''}`}
                                        </Text>
                                        <Text style={{ fontSize: 10 * fontScale, color: T.textMuted }}>· {prod.VENCIMENTO}</Text>
                                      </View>
                                    </View>
                                    <View style={{ width: 60, height: 6, backgroundColor: T.bgInput, borderRadius: 3, overflow: 'hidden' }}>
                                      <View style={{ height: '100%', width: `${Math.min(100, (days / 30) * 100)}%`, backgroundColor: barColor, borderRadius: 3 }} />
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          </Animated.View>
                        </Animated.View>
                      </TouchableOpacity>
                    );
                  })}
                </Animated.View>
                <View style={{ backgroundColor: T.blueGlow, borderRadius: 16, padding: 14, marginTop: 8, borderWidth: 1, borderColor: T.blue + '40', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Feather name="info" size={20} color={T.blue} />
                  <Text style={{ fontSize: 11 * fontScale, color: T.textSub, fontWeight: '600', flex: 1 }}>Produtos vencendo nos próximos 30 dias. Toque em um mês para expandir e ver os detalhes.</Text>
                </View>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const useDarkEnvironment = (isScanning = false) => {
  const systemScheme = Appearance.getColorScheme();
  const [state, setState] = useState({ isDarkEnv: systemScheme === 'dark', lightLevel: systemScheme === 'dark' ? 0 : 1, source: 'system' });
  const subRef = useRef(null); const sensorSubRef = useRef(null);
  const sensorAvailable = useRef(false); const pollRef = useRef(null);
  useEffect(() => {
    subRef.current = Appearance.addChangeListener(({ colorScheme }) => { if (!sensorAvailable.current) setState({ isDarkEnv: colorScheme === 'dark', lightLevel: colorScheme === 'dark' ? 0.1 : 0.9, source: 'system' }); });
    const tryLightSensor = async () => {
      try {
        const { LightSensor } = await import('expo-sensors');
        const isAvail = await LightSensor.isAvailableAsync();
        if (!isAvail) return;
        sensorAvailable.current = true;
        LightSensor.setUpdateInterval(isScanning ? 650 : 1500);
        sensorSubRef.current = LightSensor.addListener(({ illuminance }) => { const normalized = Math.min(1, illuminance / 300); setState({ isDarkEnv: illuminance < 40, lightLevel: normalized, source: 'sensor' }); });
      } catch (_) { /* noop */ }
    };
    tryLightSensor();
    if (isScanning && !pollRef.current) { pollRef.current = setInterval(() => setState(prev => ({ ...prev })), 700); }
    return () => { subRef.current?.remove(); sensorSubRef.current?.remove(); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isScanning]);
  return state;
};

const Block3D = ({ sz, anim, topColor, frontColor, rightColor }) => (
  <Animated.View style={{
    width: sz, height: sz, margin: 1.5,
    opacity: anim,
    transform: [
      { scale: anim.interpolate({ inputRange: [0, 0.5, 0.85, 1], outputRange: [0, 1.22, 0.94, 1] }) },
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-sz * 5, 0] }) },
    ],
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  }}>
    <View style={{ position: 'absolute', inset: 0, backgroundColor: frontColor, borderRadius: 7, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sz * 0.32, backgroundColor: topColor, borderTopLeftRadius: 7, borderTopRightRadius: 7 }} />
      <View style={{ position: 'absolute', top: 3, left: 5, width: sz * 0.28, height: sz * 0.13, backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 4 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, width: sz * 0.14, bottom: 0, backgroundColor: rightColor, borderTopLeftRadius: 7, borderBottomLeftRadius: 7 }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: sz * 0.18, backgroundColor: 'rgba(0,0,0,0.28)', borderBottomLeftRadius: 7, borderBottomRightRadius: 7 }} />
      <View style={{ position: 'absolute', inset: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 7 }} />
    </View>
  </Animated.View>
);

const Pinha3DScene = ({ pyramidAnims, PYRAMID_ROWS, T, resultado }) => {
  const rotateZ   = useRef(new Animated.Value(0)).current;
  const sceneOpac = useRef(new Animated.Value(0)).current;
  const loopRef   = useRef(null);

  useEffect(() => {
    Animated.timing(sceneOpac, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    loopRef.current = Animated.loop(
      Animated.timing(rotateZ, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: false })
    );
    loopRef.current.start();
    return () => { if (loopRef.current) loopRef.current.stop(); };
  }, [rotateZ, sceneOpac]);

  const spin = rotateZ.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const ROW_PALETTES = [
    { top: '#FF7A45', front: '#D44B16', right: 'rgba(0,0,0,0.3)' },
    { top: '#FFB347', front: '#D97706', right: 'rgba(0,0,0,0.28)' },
    { top: '#34D399', front: '#059669', right: 'rgba(0,0,0,0.26)' },
    { top: '#38BDF8', front: '#0284C7', right: 'rgba(0,0,0,0.24)' },
    { top: '#C084FC', front: '#7C3AED', right: 'rgba(0,0,0,0.22)' },
  ];

  const SZ = 38;
  let animIdx = 0;

  return (
    <Animated.View style={{ alignItems: 'center', opacity: sceneOpac }}>
      <View style={{ position: 'absolute', width: 260, height: 120, borderRadius: 130, backgroundColor: T.teal + '18', bottom: 0, alignSelf: 'center', shadowColor: T.teal, shadowOpacity: 0.6, shadowRadius: 30, elevation: 0 }} />
      <Animated.View style={{
        transform: [
          { perspective: 700 },
          { rotateX: '56deg' },
          { rotateZ: spin },
        ],
        marginBottom: -10,
      }}>
        <View style={{ alignItems: 'center', paddingBottom: 8 }}>
          <View style={{
            position: 'absolute',
            width: SZ * 7, height: SZ * 7,
            borderRadius: 12,
            backgroundColor: T.bgElevated,
            bottom: 0,
            borderWidth: 1.5, borderColor: T.teal + '30',
            shadowColor: T.teal, shadowOpacity: 0.2, shadowRadius: 14, elevation: 3,
          }}>
            {[1, 2, 3, 4, 5, 6].map(i => (<View key={`h${i}`} style={{ position: 'absolute', top: `${(i / 7) * 100}%`, left: 0, right: 0, height: 1, backgroundColor: T.teal + '20' }} />))}
            {[1, 2, 3, 4, 5, 6].map(i => (<View key={`v${i}`} style={{ position: 'absolute', left: `${(i / 7) * 100}%`, top: 0, bottom: 0, width: 1, backgroundColor: T.teal + '20' }} />))}
          </View>
          <View style={{ alignItems: 'center', paddingBottom: SZ * 0.5 }}>
            {PYRAMID_ROWS.map((count, ri) => {
              const pal = ROW_PALETTES[Math.min(ri, ROW_PALETTES.length - 1)];
              const row = [];
              for (let ci = 0; ci < count; ci++) {
                const curIdx = animIdx++;
                row.push(
                  <Block3D
                    key={ci}
                    sz={SZ}
                    anim={pyramidAnims[curIdx]}
                    topColor={pal.top}
                    frontColor={pal.front}
                    rightColor={pal.right}
                  />
                );
              }
              return (
                <View key={ri} style={{ flexDirection: 'row', justifyContent: 'center', zIndex: PYRAMID_ROWS.length - ri }}>
                  {row}
                </View>
              );
            })}
          </View>
        </View>
      </Animated.View>
      <View style={{ width: 180, height: 18, borderRadius: 90, backgroundColor: 'rgba(0,0,0,0.22)', marginTop: 4, alignSelf: 'center' }} />
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {ROW_PALETTES.slice(0, PYRAMID_ROWS.length).map((pal, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: pal.front + '22', borderWidth: 1, borderColor: pal.front + '55' }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: pal.front }} />
            <Text style={{ fontSize: 10, fontWeight: '800', color: pal.front }}>Camada {i + 1}</Text>
          </View>
        ))}
      </View>
      {resultado && resultado.total > 15 && (
        <View style={{ marginTop: 10, backgroundColor: T.teal + '18', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: T.teal + '50' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: T.teal, textAlign: 'center' }}>
            + {Math.ceil(resultado.total) - 15} unidades adicionais nesta pinha
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

// ─── CALCULADORA DE PINHAS POR VOZ ───────────────────────────────────────────
// Detecta "calculadora" como wake-word para abrir via voz
const detectCalculadoraCmd = (text) => {
  if (!text) return false;
  const n = stripAccents(text);
  return ['calculadora','calcular pinha','calcula pinha','calculadora de pinha','abre calculadora','abrir calculadora','abra calculadora'].some(w => n.includes(stripAccents(w)));
};

// Parser de fala para números (pt-BR)
const parseFalaNumero = (txt) => {
  if (!txt) return null;
  const n = stripAccents(txt.toLowerCase().trim());
  const numWords = {
    'zero':0,'um':1,'uma':1,'dois':2,'duas':2,'tres':3,'quatro':4,'cinco':5,
    'seis':6,'sete':7,'oito':8,'nove':9,'dez':10,'onze':11,'doze':12,
    'treze':13,'quatorze':14,'catorze':14,'quinze':15,'dezesseis':16,
    'dezessete':17,'dezoito':18,'dezenove':19,'vinte':20,'trinta':30,
    'quarenta':40,'cinquenta':50,'sessenta':60,'setenta':70,'oitenta':80,
    'noventa':90,'cem':100,'cento':100,'duzentos':200,'duzentas':200,
    'trezentos':300,'quatrocentos':400,'quinhentos':500,'seiscentos':600,
    'setecentos':700,'oitocentos':800,'novecentos':900,'mil':1000,
  };
  // Tenta número direto
  const directMatch = n.match(/^(\d+(?:[.,]\d+)?)$/);
  if (directMatch) return parseFloat(directMatch[1].replace(',', '.'));
  // Tenta extração de número no meio da frase
  const numInText = n.match(/(\d+(?:[.,]\d+)?)/);
  if (numInText) return parseFloat(numInText[1].replace(',', '.'));
  // Palavras compostas com "e" (vinte e um, etc)
  let total = 0;
  const words = n.split(/\s+e\s+|\s+/);
  for (const w of words) {
    if (numWords[w] !== undefined) total += numWords[w];
  }
  return total > 0 ? total : null;
};

// Estados da máquina de voz da calculadora
const CS = {
  IDLE: 'idle',
  OUVINDO_TUDO: 'ouvindo_tudo',   // Ouve tudo de uma vez (modo inteligente)
  AGUARDANDO: 'aguardando',        // Aguardando falar
  PROCESSANDO: 'processando',      // IA processando
  RESULTADO: 'resultado',          // Mostrando resultado
  MANUAL: 'manual',                // Modo manual (teclado)
};

const PinhasCalculatorModal = ({ visible, onClose, T, fontScale }) => {
  const [calcState, setCalcState] = useState(CS.IDLE);
  const [largura, setLargura]     = useState('');
  const [comprimento, setComprimento] = useState('');
  const [altura, setAltura]       = useState('');
  const [fardoQtd, setFardoQtd]   = useState('');
  const [estoqueAtual, setEstoqueAtual] = useState('');
  const [resultado, setResultado] = useState(null);
  const [activeTab, setActiveTab] = useState('resultado');
  const [transcript, setTranscript] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceMode, setVoiceMode]   = useState(true); // true=voz, false=manual
  const [step, setStep] = useState(1); // para modo manual

  // Animations
  const slideA       = useRef(new Animated.Value(WIN.height)).current;
  const opacA        = useRef(new Animated.Value(0)).current;
  const resultScaleA = useRef(new Animated.Value(0)).current;
  const pulseA       = useRef(new Animated.Value(1)).current;
  const glowA        = useRef(new Animated.Value(0)).current;
  const micPulse     = useRef(new Animated.Value(1)).current;
  const micGlow      = useRef(new Animated.Value(0)).current;
  const waveA        = useRef([
    new Animated.Value(0.3),
    new Animated.Value(0.6),
    new Animated.Value(1.0),
    new Animated.Value(0.7),
    new Animated.Value(0.4),
    new Animated.Value(0.9),
    new Animated.Value(0.5),
  ]).current;

  const pulseLoopRef   = useRef(null);
  const glowLoopRef    = useRef(null);
  const micLoopRef     = useRef(null);
  const waveLoopRef    = useRef(null);
  const listenTimeRef  = useRef(null);
  const mountedRef     = useRef(true);

  const PYRAMID_ROWS  = [5, 4, 3, 2, 1];
  const TOTAL_PYRAMID = 15;
  const pyramidAnims  = useRef([...Array(TOTAL_PYRAMID)].map(() => new Animated.Value(0))).current;

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Animação de ondas do microfone
  const startWaveAnim = useCallback(() => {
    if (waveLoopRef.current) { waveLoopRef.current.stop(); waveLoopRef.current = null; }
    const anims = waveA.map((a, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 80),
        Animated.timing(a, { toValue: 1, duration: 350 + i * 60, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(a, { toValue: 0.15 + Math.random() * 0.3, duration: 350 + i * 60, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]))
    );
    waveLoopRef.current = Animated.parallel(anims);
    waveLoopRef.current.start();
  }, [waveA]);

  const stopWaveAnim = useCallback(() => {
    if (waveLoopRef.current) { waveLoopRef.current.stop(); waveLoopRef.current = null; }
    waveA.forEach(a => Animated.timing(a, { toValue: 0.3, duration: 200, useNativeDriver: false }).start());
  }, [waveA]);

  const startMicPulse = useCallback(() => {
    if (micLoopRef.current) { micLoopRef.current.stop(); micLoopRef.current = null; }
    micLoopRef.current = Animated.loop(Animated.parallel([
      Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.18, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(micPulse, { toValue: 0.96, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.timing(micGlow, { toValue: 1, duration: 650, useNativeDriver: false }),
        Animated.timing(micGlow, { toValue: 0.3, duration: 650, useNativeDriver: false }),
      ]),
    ]));
    micLoopRef.current.start();
  }, [micPulse, micGlow]);

  const stopMicPulse = useCallback(() => {
    if (micLoopRef.current) { micLoopRef.current.stop(); micLoopRef.current = null; }
    micPulse.setValue(1); micGlow.setValue(0);
  }, [micPulse, micGlow]);

  useEffect(() => {
    if (visible) {
      setCalcState(voiceMode ? CS.AGUARDANDO : CS.MANUAL);
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 52, friction: 11, useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start(() => {
        if (voiceMode && mountedRef.current) {
          setTimeout(() => startListening(), 700);
        }
      });
    } else {
      stopListening();
      stopMicPulse();
      stopWaveAnim();
      if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
      if (glowLoopRef.current) { glowLoopRef.current.stop(); glowLoopRef.current = null; }
      Animated.parallel([
        Animated.timing(slideA, { toValue: WIN.height, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]).start();
    }
  }, [visible]);

  const reset = useCallback(() => {
    setLargura(''); setComprimento(''); setAltura('');
    setFardoQtd(''); setEstoqueAtual(''); setResultado(null);
    setActiveTab('resultado'); setTranscript(''); setStatusMsg('');
    setStep(1);
    pyramidAnims.forEach(a => a.setValue(0));
    resultScaleA.setValue(0); pulseA.setValue(1); glowA.setValue(0);
    if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
    if (glowLoopRef.current)  { glowLoopRef.current.stop(); glowLoopRef.current = null; }
    stopMicPulse(); stopWaveAnim();
  }, []);

  const handleClose = useCallback(() => {
    cancelledRef.current = true;
    setIsListening(false);
    stopMicPulse();
    stopWaveAnim();
    if (listenTimeRef.current) { clearTimeout(listenTimeRef.current); listenTimeRef.current = null; }
    // Pequeno delay: dá tempo ao módulo de voz de fechar a sessão antes
    // do always-on tentar reabrir (evita colisão de sessões)
    setTimeout(() => {
      reset();
      onClose();
    }, 350);
  }, [reset, onClose, stopMicPulse, stopWaveAnim]);

  // ── Parar reconhecimento de voz ───────────────────────────────────────────
  // IMPORTANTE: não chamamos ExpoSpeechRecognitionModule.stop() diretamente aqui
  // para não interferir com o sistema always-on. Usamos um ref de cancelamento
  // e aguardamos o evento 'end' natural do módulo.
  const cancelledRef = useRef(false);
  const stopListening = useCallback(() => {
    if (listenTimeRef.current) { clearTimeout(listenTimeRef.current); listenTimeRef.current = null; }
    cancelledRef.current = true;
    // Tenta parar suavemente — se falhar, o evento 'end' virá de qualquer forma
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
    setIsListening(false);
    stopMicPulse();
    stopWaveAnim();
  }, [stopMicPulse, stopWaveAnim]);

  // ── Iniciar reconhecimento de voz ─────────────────────────────────────────
  const startListening = useCallback(async () => {
    cancelledRef.current = false;
    if (!SPEECH_RECOGNITION_AVAILABLE) {
      setStatusMsg('Reconhecimento de voz indisponível. Use o modo manual.');
      setVoiceMode(false);
      setCalcState(CS.MANUAL);
      return;
    }
    const ok = await requestMicPermission();
    if (!ok) {
      setStatusMsg('Permissão de microfone necessária.');
      setVoiceMode(false);
      setCalcState(CS.MANUAL);
      return;
    }
    try {
      setCalcState(CS.OUVINDO_TUDO);
      setIsListening(true);
      setTranscript('');
      setStatusMsg('Ouvindo... Fale as dimensões do produto!');
      startMicPulse();
      startWaveAnim();
      await ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: true, continuous: false });
      // Timeout de segurança
      listenTimeRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        stopListening();
        setStatusMsg('Nenhuma fala detectada. Toque no microfone para tentar de novo.');
        setCalcState(CS.AGUARDANDO);
      }, 14000);
    } catch (e) {
      setIsListening(false);
      stopMicPulse();
      stopWaveAnim();
      setStatusMsg('Erro ao iniciar microfone. Tente de novo.');
      setCalcState(CS.AGUARDANDO);
    }
  }, [startMicPulse, startWaveAnim, stopListening]);

  // ── Listener de resultado de voz ─────────────────────────────────────────
  // Usamos _SafeSpeechEventWrapper (compatível com Expo Go)
  const handleSpeechResult = useCallback((event) => {
    if (!visible || calcState !== CS.OUVINDO_TUDO) return;
    const text = event?.results?.[0]?.transcript || '';
    if (text) setTranscript(text);
  }, [visible, calcState]);

  const handleSpeechEnd = useCallback(() => {
    if (!visible || cancelledRef.current) return;
    if (listenTimeRef.current) { clearTimeout(listenTimeRef.current); listenTimeRef.current = null; }
    setIsListening(false);
    stopMicPulse();
    stopWaveAnim();
    if (calcState === CS.OUVINDO_TUDO && transcript.trim().length > 2) {
      processVoiceInput(transcript);
    } else if (calcState === CS.OUVINDO_TUDO) {
      setStatusMsg('Não entendi. Tente de novo ou use o modo manual.');
      setCalcState(CS.AGUARDANDO);
    }
  }, [visible, calcState, transcript, stopMicPulse, stopWaveAnim]);

  // ── Processar entrada de voz com IA ──────────────────────────────────────
  const processVoiceInput = useCallback(async (text) => {
    if (!mountedRef.current) return;
    setCalcState(CS.PROCESSANDO);
    setStatusMsg('Analisando com IA...');

    // Falar enquanto processa
    speakWithElevenLabs('Calculando! Aguarde um momento.', () => {});

    const prompt = `Você é um assistente que extrai dimensões de produto de uma frase em português.
O usuário disse: "${text}"

Extraia EXATAMENTE estes valores (números inteiros ou decimais):
- comprimento: fardos de comprimento (ou frente, profundidade)
- largura: fardos de largura (ou lado, lateral)
- altura: fardos de altura (ou alto, cima)
- produtos_por_fardo: quantidade de produtos/unidades dentro de cada fardo/caixa (ou "vem X produtos", "X unidades no fardo")
- estoque: quantidade atual em estoque (se mencionado, senão 0)

REGRAS IMPORTANTES:
- "fardos de comprimento" = comprimento (dimensão do espaço, não produto)
- "produtos que vêm no fardo" = produtos_por_fardo
- Se o usuário disser "6 fardos de comprimento e 6 de largura e 7 de altura e no fardo vem 8 produtos", extraia comprimento=6, largura=6, altura=7, produtos_por_fardo=8

Responda APENAS em JSON válido, sem texto extra, sem markdown:
{"comprimento": número, "largura": número, "altura": número, "produtos_por_fardo": número, "estoque": número}`;

    try {
      let raw = '';
      try { raw = await callGeminiOptimized(prompt, false); } catch { /* noop */ }
      if (!raw) { try { raw = await callGroqOptimized(prompt, null, false); } catch { /* noop */ } }

      if (!raw) throw new Error('IA indisponível');

      // Extrai JSON da resposta
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error('Formato inválido');
      const parsed = JSON.parse(match[0]);

      const c = parseFloat(parsed.comprimento) || 0;
      const l = parseFloat(parsed.largura) || 0;
      const a = parseFloat(parsed.altura) || 0;
      const f = parseFloat(parsed.produtos_por_fardo) || parseFloat(parsed.fardo) || 0;
      const e = parseFloat(parsed.estoque) || 0;

      if (c <= 0 || l <= 0 || a <= 0 || f <= 0) {
        throw new Error('Valores não encontrados');
      }

      if (!mountedRef.current) return;
      setComprimento(String(c));
      setLargura(String(l));
      setAltura(String(a));
      setFardoQtd(String(f));
      setEstoqueAtual(e > 0 ? String(e) : '');

      // Calcular resultado
      const total = l * c * a * f;
      const totalCeil = Math.ceil(total);
      const pinhasNecessarias = e > 0 && totalCeil > 0 ? Math.ceil(e / totalCeil) : 0;
      const ocupacao = e > 0 && totalCeil > 0 ? Math.min(100, (e / totalCeil) * 100) : 0;
      const res = { total, totalCeil, l, c, a, f, estoque: e, pinhasNecessarias, ocupacao };

      if (!mountedRef.current) return;
      setResultado(res);
      setCalcState(CS.RESULTADO);
      setStatusMsg('');
      animateResult();

      // Resposta por voz
      let msg = `Calculei! Cada pinha comporta ${totalCeil} unidades. `;
      msg += `Dimensões: largura ${l}, comprimento ${c}, altura ${a}, com ${f} produtos por fardo. `;
      if (e > 0) {
        msg += `Com ${e} unidades no estoque, você vai precisar de ${pinhasNecessarias} pinha${pinhasNecessarias !== 1 ? 's' : ''}.`;
      } else {
        msg += `Informe o estoque atual para calcular quantas pinhas você vai precisar.`;
      }
      speakWithElevenLabs(msg, () => {});

    } catch (err) {
      console.warn('[CalcPinha] Erro IA:', err.message);
      if (!mountedRef.current) return;

      // Fallback: tenta parsear manualmente com regex
      const nums = text.match(/\d+(?:[.,]\d+)?/g);
      if (nums && nums.length >= 4) {
        const l = parseFloat(nums[0]);
        const c = parseFloat(nums[1]);
        const a = parseFloat(nums[2]);
        const f = parseFloat(nums[3]);
        const e = nums[4] ? parseFloat(nums[4]) : 0;
        if (l > 0 && c > 0 && a > 0 && f > 0) {
          setLargura(String(l)); setComprimento(String(c));
          setAltura(String(a)); setFardoQtd(String(f));
          setEstoqueAtual(e > 0 ? String(e) : '');
          const total = l * c * a * f;
          const totalCeil = Math.ceil(total);
          const pinhasNecessarias = e > 0 && totalCeil > 0 ? Math.ceil(e / totalCeil) : 0;
          const ocupacao = e > 0 && totalCeil > 0 ? Math.min(100, (e / totalCeil) * 100) : 0;
          const res = { total, totalCeil, l, c, a, f, estoque: e, pinhasNecessarias, ocupacao };
          setResultado(res);
          setCalcState(CS.RESULTADO);
          setStatusMsg('');
          animateResult();
          speakWithElevenLabs(`Cada pinha comporta ${totalCeil} unidades.`, () => {});
          return;
        }
      }

      setStatusMsg('Não consegui extrair os dados. Tente falar mais claramente ou use o modo manual.');
      setCalcState(CS.AGUARDANDO);
      speakWithElevenLabs('Não entendi os dados. Tente falar de novo, por exemplo: largura seis, comprimento seis, altura sete, oito produtos por fardo.', () => {});
    }
  }, []);

  // ── Animação do resultado ─────────────────────────────────────────────────
  const animateResult = useCallback(() => {
    setTimeout(() => {
      if (!mountedRef.current) return;
      pyramidAnims.forEach(aa => aa.setValue(0));
      resultScaleA.setValue(0);
      let idx = 0;
      const rowAnims = [];
      for (let ri = 0; ri < PYRAMID_ROWS.length; ri++) {
        for (let ci = 0; ci < PYRAMID_ROWS[ri]; ci++) {
          rowAnims.push({ anim: pyramidAnims[idx], delay: ri * 100 + ci * 40 });
          idx++;
        }
      }
      Animated.parallel(
        rowAnims.map(({ anim, delay }) =>
          Animated.sequence([
            Animated.delay(delay),
            Animated.spring(anim, { toValue: 1, tension: 130, friction: 7, useNativeDriver: false }),
          ])
        )
      ).start(() => {
        if (!mountedRef.current) return;
        Animated.spring(resultScaleA, { toValue: 1, tension: 80, friction: 8, useNativeDriver: false }).start();
        pulseLoopRef.current = Animated.loop(Animated.sequence([
          Animated.timing(pulseA, { toValue: 1.06, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulseA, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]));
        pulseLoopRef.current.start();
        glowLoopRef.current = Animated.loop(Animated.sequence([
          Animated.timing(glowA, { toValue: 1, duration: 1200, useNativeDriver: false }),
          Animated.timing(glowA, { toValue: 0, duration: 1200, useNativeDriver: false }),
        ]));
        glowLoopRef.current.start();
      });
    }, 120);
  }, [pyramidAnims, resultScaleA, pulseA, glowA]);

  // ── Modo manual: calcular ─────────────────────────────────────────────────
  const calcularManual = useCallback(() => {
    const l = parseFloat(largura) || 0;
    const c = parseFloat(comprimento) || 0;
    const a = parseFloat(altura) || 0;
    const f = parseInt(fardoQtd) || 0;
    const estoque = parseInt(estoqueAtual) || 0;
    if (l <= 0 || c <= 0 || a <= 0 || f <= 0) {
      AppAlert.alert('⚠️ Atenção', 'Preencha todos os campos corretamente.'); return;
    }
    const total = l * c * a * f;
    const totalCeil = Math.ceil(total);
    const pinhasNecessarias = estoque > 0 && totalCeil > 0 ? Math.ceil(estoque / totalCeil) : 0;
    const ocupacao = estoque > 0 && totalCeil > 0 ? Math.min(100, (estoque / totalCeil) * 100) : 0;
    setResultado({ total, totalCeil, l, c, a, f, estoque, pinhasNecessarias, ocupacao });
    setCalcState(CS.RESULTADO);
    animateResult();
    speakWithElevenLabs(`Calculado! Cada pinha comporta ${totalCeil} unidades.`, () => {});
  }, [largura, comprimento, altura, fardoQtd, estoqueAtual, animateResult]);

  const MiniBarChart = ({ data }) => {
    const maxVal = Math.max(...data.map(d => d.value), 1);
    return (
      <View style={{ gap: 8 }}>
        {data.map((item, i) => (
          <View key={i}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: T.textSub }}>{item.label}</Text>
              <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.text }}>{item.value}</Text>
            </View>
            <View style={{ height: 8, backgroundColor: T.bgInput, borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${(item.value / maxVal) * 100}%`, backgroundColor: T.teal, borderRadius: 4 }} />
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      {/* Listeners de voz invisíveis */}
      <_SafeSpeechEventWrapper eventName="result" onEvent={handleSpeechResult} />
      <_SafeSpeechEventWrapper eventName="end" onEvent={handleSpeechEnd} />

      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', opacity: opacA }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: T.bgCard, borderTopLeftRadius: 32, borderTopRightRadius: 32,
          borderWidth: 1.5, borderColor: T.teal + '50',
          transform: [{ translateY: slideA }],
          maxHeight: WIN.height * 0.92,
          shadowColor: T.teal, shadowOpacity: 0.3, shadowRadius: 30, elevation: 28,
        }}>
          {/* Handle bar */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: T.border }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingBottom: 14, paddingTop: 6 }}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: T.teal + '50', marginRight: 12 }}>
              <MaterialCommunityIcons name="calculator-variant" size={24} color={T.teal} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>Calculadora de Pinhas</Text>
              <Text style={{ fontSize: 12 * fontScale, color: T.textSub, fontWeight: '600' }}>Por voz ou manual · IA integrada</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* Toggle voz/manual */}
              <TouchableOpacity onPress={() => {
                const next = !voiceMode;
                setVoiceMode(next);
                stopListening();
                reset();
                setCalcState(next ? CS.AGUARDANDO : CS.MANUAL);
              }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: voiceMode ? T.teal + '20' : T.bgInput, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1.5, borderColor: voiceMode ? T.teal + '60' : T.border }}>
                <Feather name={voiceMode ? 'mic' : 'edit-3'} size={13} color={voiceMode ? T.teal : T.textSub} />
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: voiceMode ? T.teal : T.textSub }}>{voiceMode ? 'Voz' : 'Manual'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
                <Feather name="x" size={18} color={T.textSub} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Divisor */}
          <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 0 }} />

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ═══ MODO VOZ ═══ */}
              {voiceMode && (
                <View style={{ gap: 16 }}>

                  {/* Estado: aguardando ou ouvindo */}
                  {(calcState === CS.AGUARDANDO || calcState === CS.OUVINDO_TUDO) && (
                    <View style={{ gap: 14 }}>
                      {/* Dica de uso */}
                      <View style={{ backgroundColor: T.tealGlow, borderRadius: 20, padding: 16, borderWidth: 1.5, borderColor: T.teal + '50' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <MaterialCommunityIcons name="lightbulb-on" size={18} color={T.teal} />
                          <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 0.8 }}>Como usar</Text>
                        </View>
                        <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', lineHeight: 20 }}>
                          Fale de uma vez tudo:{'\n'}
                          <Text style={{ color: T.text, fontWeight: '800' }}>"Largura 6, comprimento 6, altura 7 e no fardo vem 8 produtos"</Text>
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                          {['L × C × A × Fardo', 'Resposta por voz', 'IA interpreta tudo'].map((tag, i) => (
                            <View key={i} style={{ backgroundColor: T.teal + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: T.teal + '40' }}>
                              <Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.teal }}>✓ {tag}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Botão microfone central */}
                      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                        {/* Ondas de áudio */}
                        {calcState === CS.OUVINDO_TUDO && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginBottom: 14, height: 50 }}>
                            {waveA.map((a, i) => (
                              <Animated.View key={i} style={{
                                width: 4, borderRadius: 2,
                                backgroundColor: T.teal,
                                height: a.interpolate({ inputRange: [0, 1], outputRange: [6, 44] }),
                                opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                              }} />
                            ))}
                          </View>
                        )}

                        {calcState !== CS.OUVINDO_TUDO && <View style={{ height: 64 }} />}

                        {/* Círculos de glow */}
                        <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center', width: 120, height: 120 }}>
                          {calcState === CS.OUVINDO_TUDO && (
                            <>
                              <Animated.View style={{ position: 'absolute', width: micGlow.interpolate({ inputRange: [0, 1], outputRange: [100, 130] }), height: micGlow.interpolate({ inputRange: [0, 1], outputRange: [100, 130] }), borderRadius: 65, backgroundColor: T.teal, opacity: micGlow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.0] }) }} />
                              <Animated.View style={{ position: 'absolute', width: micGlow.interpolate({ inputRange: [0, 1], outputRange: [88, 112] }), height: micGlow.interpolate({ inputRange: [0, 1], outputRange: [88, 112] }), borderRadius: 56, backgroundColor: T.teal, opacity: micGlow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.07] }) }} />
                            </>
                          )}
                          <Animated.View style={{ transform: [{ scale: calcState === CS.OUVINDO_TUDO ? micPulse : 1 }] }}>
                            <TouchableOpacity
                              onPress={calcState === CS.OUVINDO_TUDO ? stopListening : startListening}
                              activeOpacity={0.85}
                              style={{
                                width: 88, height: 88, borderRadius: 44,
                                backgroundColor: calcState === CS.OUVINDO_TUDO ? T.teal : T.bgElevated,
                                justifyContent: 'center', alignItems: 'center',
                                borderWidth: 3,
                                borderColor: calcState === CS.OUVINDO_TUDO ? T.teal : T.border,
                                shadowColor: T.teal,
                                shadowOpacity: calcState === CS.OUVINDO_TUDO ? 0.55 : 0.15,
                                shadowRadius: 18, elevation: 12,
                              }}
                            >
                              <Feather
                                name={calcState === CS.OUVINDO_TUDO ? 'mic' : 'mic-off'}
                                size={36}
                                color={calcState === CS.OUVINDO_TUDO ? '#FFF' : T.textSub}
                              />
                            </TouchableOpacity>
                          </Animated.View>
                        </View>

                        <Text style={{ marginTop: 16, fontSize: 13 * fontScale, fontWeight: '700', color: calcState === CS.OUVINDO_TUDO ? T.teal : T.textSub, textAlign: 'center' }}>
                          {calcState === CS.OUVINDO_TUDO ? '🎙️ Ouvindo...' : 'Toque para falar'}
                        </Text>

                        {/* Transcript em tempo real */}
                        {transcript.length > 0 && (
                          <View style={{ marginTop: 12, backgroundColor: T.bgElevated, borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: T.teal + '50', width: '100%' }}>
                            <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>Ouvindo:</Text>
                            <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '700', lineHeight: 18 }} numberOfLines={3}>{transcript}</Text>
                          </View>
                        )}

                        {statusMsg.length > 0 && (
                          <Text style={{ marginTop: 10, fontSize: 12 * fontScale, color: T.textSub, textAlign: 'center', fontWeight: '600', lineHeight: 18 }}>{statusMsg}</Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Estado: processando IA */}
                  {calcState === CS.PROCESSANDO && (
                    <View style={{ alignItems: 'center', paddingVertical: 30, gap: 20 }}>
                      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 2.5, borderColor: T.teal + '60', shadowColor: T.teal, shadowOpacity: 0.3, shadowRadius: 18, elevation: 10 }}>
                        <ActivityIndicator size="large" color={T.teal} />
                      </View>
                      <View style={{ alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 16 * fontScale, fontWeight: '900', color: T.text }}>IA processando...</Text>
                        <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '600', textAlign: 'center' }}>Gemini está interpretando o que você disse</Text>
                      </View>
                      {transcript.length > 0 && (
                        <View style={{ backgroundColor: T.bgElevated, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: T.blue + '40', width: '100%' }}>
                          <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Você disse:</Text>
                          <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '700', lineHeight: 18 }}>"{transcript}"</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Estado: resultado */}
                  {calcState === CS.RESULTADO && resultado && (
                    <View style={{ gap: 14 }}>
                      {/* Dados extraídos */}
                      <View style={{ backgroundColor: T.tealGlow, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: T.teal + '60' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <Feather name="check-circle" size={16} color={T.teal} />
                          <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 0.8 }}>Dados extraídos pela IA</Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {[
                            { label: 'Largura', value: `${resultado.l} fardos`, icon: '📦' },
                            { label: 'Comprimento', value: `${resultado.c} fardos`, icon: '📏' },
                            { label: 'Altura', value: `${resultado.a} fardos`, icon: '📐' },
                            { label: 'Por fardo', value: `${resultado.f} un`, icon: '🧮' },
                          ].map((item, i) => (
                            <View key={i} style={{ flex: 1, minWidth: '45%', backgroundColor: T.bgCard, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: T.teal + '30', alignItems: 'center' }}>
                              <Text style={{ fontSize: 16 }}>{item.icon}</Text>
                              <Text style={{ fontSize: 8 * fontScale, fontWeight: '800', color: T.textMuted, textTransform: 'uppercase', marginTop: 3 }}>{item.label}</Text>
                              <Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: T.text, marginTop: 2 }}>{item.value}</Text>
                            </View>
                          ))}
                        </View>
                        {transcript.length > 0 && (
                          <View style={{ marginTop: 10, backgroundColor: T.bgCard, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: T.border }}>
                            <Text style={{ fontSize: 10 * fontScale, fontWeight: '700', color: T.textMuted }}>📣 "{transcript}"</Text>
                          </View>
                        )}
                      </View>

                      {/* Abas */}
                      <View style={{ flexDirection: 'row', backgroundColor: T.bgElevated, borderRadius: 14, padding: 4, gap: 2 }}>
                        {[{ key: 'resultado', label: '3D', icon: 'cube-outline' }, { key: 'grafico', label: 'Gráfico', icon: 'bar-chart-2' }, { key: 'estoque', label: 'Estoque', icon: 'layers' }].map(tab => (
                          <TouchableOpacity key={tab.key} onPress={() => setActiveTab(tab.key)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: activeTab === tab.key ? T.teal : 'transparent' }}>
                            <Feather name={tab.icon} size={13} color={activeTab === tab.key ? '#FFF' : T.textSub} />
                            <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: activeTab === tab.key ? '#FFF' : T.textSub }}>{tab.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {/* Aba 3D */}
                      {activeTab === 'resultado' && (
                        <View style={{ gap: 12 }}>
                          <View style={{ backgroundColor: T.bgElevated, borderRadius: 24, paddingTop: 16, paddingBottom: 14, paddingHorizontal: 8, borderWidth: 2, borderColor: T.teal + '55', shadowColor: T.teal, shadowOpacity: 0.2, shadowRadius: 18, elevation: 8, overflow: 'hidden' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12, paddingHorizontal: 8 }}>
                              <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: glowA.interpolate({ inputRange: [0, 1], outputRange: [T.teal, T.green] }), shadowColor: T.teal, shadowOpacity: 0.9, shadowRadius: 5 }} />
                              <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 1.4 }}>Pinha 3D · Perspectiva orbital</Text>
                            </View>
                            <Pinha3DScene pyramidAnims={pyramidAnims} PYRAMID_ROWS={PYRAMID_ROWS} T={T} resultado={resultado} />
                          </View>
                          <Animated.View style={{ backgroundColor: T.tealGlow, borderRadius: 22, padding: 20, borderWidth: 2, borderColor: glowA.interpolate({ inputRange: [0, 1], outputRange: [T.teal + '70', T.green + '90'] }), alignItems: 'center', transform: [{ scale: resultScaleA }], shadowColor: T.teal, shadowOpacity: 0.25, shadowRadius: 18, elevation: 10 }}>
                            <Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 6 }}>Total da Pinha</Text>
                            <Animated.Text style={{ fontSize: 70 * fontScale, fontWeight: '900', color: T.teal, letterSpacing: -3, lineHeight: 74 * fontScale, transform: [{ scale: pulseA }], textShadowColor: T.teal + '40', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 }}>
                              {resultado.totalCeil}
                            </Animated.Text>
                            <Text style={{ fontSize: 13 * fontScale, color: T.teal, fontWeight: '700', marginTop: 6, opacity: 0.85 }}>unidades calculadas</Text>
                          </Animated.View>
                          <View style={{ backgroundColor: T.bgElevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: T.border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <MaterialCommunityIcons name="function-variant" size={16} color={T.blue} />
                              <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.7 }}>Fórmula: L × C × A × Fardo</Text>
                            </View>
                            <View style={{ backgroundColor: T.bgCard, borderRadius: 11, padding: 12, borderWidth: 1, borderColor: T.border }}>
                              <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '800' }}>{resultado.l} × {resultado.c} × {resultado.a} × {resultado.f} = <Text style={{ color: T.teal, fontSize: 17 * fontScale }}>{resultado.totalCeil} un</Text></Text>
                            </View>
                          </View>
                        </View>
                      )}

                      {/* Aba Gráfico */}
                      {activeTab === 'grafico' && (
                        <View style={{ gap: 12 }}>
                          <View style={{ backgroundColor: T.bgElevated, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: T.blue + '40' }}>
                            <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Composição da Pinha</Text>
                            <MiniBarChart data={[
                              { label: `Largura (${resultado.l})`, value: parseFloat(resultado.l) },
                              { label: `Comprimento (${resultado.c})`, value: parseFloat(resultado.c) },
                              { label: `Altura (${resultado.a})`, value: parseFloat(resultado.a) },
                              { label: `Por fardo (${resultado.f})`, value: parseFloat(resultado.f) },
                            ]} />
                          </View>
                        </View>
                      )}

                      {/* Aba Estoque */}
                      {activeTab === 'estoque' && (
                        <View style={{ gap: 12 }}>
                          {resultado.estoque > 0 ? (
                            <View style={{ gap: 10 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.bgElevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: T.blue + '40' }}>
                                <Feather name="layers" size={22} color={T.blue} />
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 0.7 }}>Ocupação da pinha</Text>
                                  <Text style={{ fontSize: 22 * fontScale, fontWeight: '900', color: T.text }}>{resultado.ocupacao.toFixed(1)}%</Text>
                                </View>
                              </View>
                              <View style={{ height: 12, backgroundColor: T.bgInput, borderRadius: 6, overflow: 'hidden' }}>
                                <View style={{ height: '100%', width: `${resultado.ocupacao}%`, backgroundColor: resultado.ocupacao > 80 ? T.green : resultado.ocupacao > 50 ? T.amber : T.red, borderRadius: 6 }} />
                              </View>
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                {[
                                  { icon: 'package', label: 'Por pinha', value: resultado.totalCeil + ' un', color: T.teal },
                                  { icon: 'layers', label: 'Estoque', value: resultado.estoque + ' un', color: T.blue },
                                  { icon: 'grid', label: 'Pinhas', value: resultado.pinhasNecessarias, color: T.purple },
                                ].map((s, i) => (
                                  <View key={i} style={{ flex: 1, backgroundColor: T.bgElevated, borderRadius: 13, padding: 10, borderWidth: 1.5, borderColor: s.color + '40', alignItems: 'center' }}>
                                    <Feather name={s.icon} size={16} color={s.color} style={{ marginBottom: 5 }} />
                                    <Text style={{ fontSize: 8 * fontScale, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', marginBottom: 4, textAlign: 'center' }}>{s.label}</Text>
                                    <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: s.color }}>{s.value}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          ) : (
                            <View style={{ alignItems: 'center', backgroundColor: T.bgElevated, borderRadius: 20, padding: 28, borderWidth: 1, borderColor: T.border }}>
                              <Feather name="layers" size={44} color={T.textMuted} style={{ marginBottom: 12 }} />
                              <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 6 }}>Estoque não informado</Text>
                              <Text style={{ fontSize: 12 * fontScale, color: T.textSub, fontWeight: '600', textAlign: 'center', lineHeight: 18, marginBottom: 16 }}>Fale de novo informando o estoque para eu calcular quantas pinhas você precisará.</Text>
                            </View>
                          )}
                        </View>
                      )}

                      {/* Botões ação */}
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => { reset(); setCalcState(CS.AGUARDANDO); setTimeout(startListening, 300); }} style={{ flex: 1, height: 50, borderRadius: 15, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.border, flexDirection: 'row', gap: 7 }}>
                          <Feather name="mic" size={15} color={T.teal} />
                          <Text style={{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }}>Recalcular</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleClose} style={{ flex: 1.6, height: 50, borderRadius: 15, backgroundColor: T.teal, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 7, shadowColor: T.teal, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 }}>
                          <Feather name="check-circle" size={16} color="#FFF" />
                          <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: '#FFF' }}>Concluído</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* ═══ MODO MANUAL ═══ */}
              {!voiceMode && (
                <View style={{ gap: 14 }}>
                  {calcState !== CS.RESULTADO && (
                    <View style={{ gap: 12 }}>
                      <Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.textSub, textAlign: 'center' }}>Preencha as dimensões manualmente</Text>
                      {[
                        { label: 'Largura (fardos)', value: largura, set: setLargura, icon: 'arrow-left-right', hint: 'lado a lado' },
                        { label: 'Comprimento (fardos)', value: comprimento, set: setComprimento, icon: 'arrow-expand-horizontal', hint: 'frente ↔ fundo' },
                        { label: 'Altura (fardos)', value: altura, set: setAltura, icon: 'arrow-expand-vertical', hint: 'baixo ↑ cima' },
                      ].map(({ label, value, set, icon, hint }) => (
                        <View key={label}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                            <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
                            <Text style={{ fontSize: 10 * fontScale, fontWeight: '600', color: T.textMuted }}>{hint}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderRadius: 14, borderWidth: 2, borderColor: value ? T.teal + '80' : T.border, paddingHorizontal: 12, gap: 8 }}>
                            <MaterialCommunityIcons name={icon} size={17} color={value ? T.teal : T.textMuted} />
                            <TextInput style={{ flex: 1, paddingVertical: 12, fontSize: 18 * fontScale, color: T.text, fontWeight: '900' }} placeholder="0" placeholderTextColor={T.textMuted} value={value} onChangeText={set} keyboardType="decimal-pad" />
                          </View>
                        </View>
                      ))}
                      <View key="fardo">
                        <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Produtos por fardo</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderRadius: 14, borderWidth: 2, borderColor: fardoQtd ? T.orange + '80' : T.border, paddingHorizontal: 12, gap: 8 }}>
                          <MaterialCommunityIcons name="package-variant-closed" size={17} color={fardoQtd ? T.orange : T.textMuted} />
                          <TextInput style={{ flex: 1, paddingVertical: 12, fontSize: 18 * fontScale, color: T.text, fontWeight: '900' }} placeholder="ex: 8" placeholderTextColor={T.textMuted} value={fardoQtd} onChangeText={setFardoQtd} keyboardType="numeric" />
                          <Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: T.textMuted }}>un/fardo</Text>
                        </View>
                      </View>
                      <View key="estoque">
                        <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Estoque atual <Text style={{ color: T.textMuted, fontWeight: '600', fontSize: 9 * fontScale }}>(opcional)</Text></Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderRadius: 14, borderWidth: 2, borderColor: estoqueAtual ? T.blue + '80' : T.border, paddingHorizontal: 12, gap: 8 }}>
                          <Feather name="layers" size={17} color={estoqueAtual ? T.blue : T.textMuted} />
                          <TextInput style={{ flex: 1, paddingVertical: 12, fontSize: 18 * fontScale, color: T.text, fontWeight: '900' }} placeholder="0" placeholderTextColor={T.textMuted} value={estoqueAtual} onChangeText={setEstoqueAtual} keyboardType="numeric" />
                          <Text style={{ fontSize: 11 * fontScale, fontWeight: '700', color: T.textMuted }}>un</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={calcularManual} style={{ height: 54, borderRadius: 16, backgroundColor: T.teal, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 4, shadowColor: T.teal, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8 }}>
                        <MaterialCommunityIcons name="calculator-variant" size={20} color="#FFF" />
                        <Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: '#FFF' }}>Calcular Pinha</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {calcState === CS.RESULTADO && resultado && (
                    <View style={{ gap: 14 }}>
                      <View style={{ flexDirection: 'row', backgroundColor: T.bgElevated, borderRadius: 14, padding: 4, gap: 2 }}>
                        {[{ key: 'resultado', label: '3D', icon: 'cube-outline' }, { key: 'grafico', label: 'Gráfico', icon: 'bar-chart-2' }, { key: 'estoque', label: 'Estoque', icon: 'layers' }].map(tab => (
                          <TouchableOpacity key={tab.key} onPress={() => setActiveTab(tab.key)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: activeTab === tab.key ? T.teal : 'transparent' }}>
                            <Feather name={tab.icon} size={13} color={activeTab === tab.key ? '#FFF' : T.textSub} />
                            <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: activeTab === tab.key ? '#FFF' : T.textSub }}>{tab.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {activeTab === 'resultado' && (
                        <View style={{ gap: 12 }}>
                          <View style={{ backgroundColor: T.bgElevated, borderRadius: 24, paddingTop: 16, paddingBottom: 14, paddingHorizontal: 8, borderWidth: 2, borderColor: T.teal + '55', overflow: 'hidden' }}>
                            <Pinha3DScene pyramidAnims={pyramidAnims} PYRAMID_ROWS={PYRAMID_ROWS} T={T} resultado={resultado} />
                          </View>
                          <Animated.View style={{ backgroundColor: T.tealGlow, borderRadius: 22, padding: 20, borderWidth: 2, borderColor: T.teal + '70', alignItems: 'center', transform: [{ scale: resultScaleA }] }}>
                            <Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 6 }}>Total da Pinha</Text>
                            <Animated.Text style={{ fontSize: 70 * fontScale, fontWeight: '900', color: T.teal, letterSpacing: -3, lineHeight: 74 * fontScale, transform: [{ scale: pulseA }] }}>
                              {resultado.totalCeil}
                            </Animated.Text>
                            <Text style={{ fontSize: 13 * fontScale, color: T.teal, fontWeight: '700', marginTop: 6 }}>unidades calculadas</Text>
                          </Animated.View>
                          <View style={{ backgroundColor: T.bgCard, borderRadius: 11, padding: 12, borderWidth: 1, borderColor: T.border }}>
                            <Text style={{ fontSize: 13 * fontScale, color: T.textSub, fontWeight: '800' }}>{resultado.l} × {resultado.c} × {resultado.a} × {resultado.f} = <Text style={{ color: T.teal, fontSize: 17 * fontScale }}>{resultado.totalCeil} un</Text></Text>
                          </View>
                        </View>
                      )}
                      {activeTab === 'grafico' && (
                        <View style={{ backgroundColor: T.bgElevated, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: T.blue + '40' }}>
                          <Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Composição</Text>
                          <MiniBarChart data={[
                            { label: `Largura (${resultado.l})`, value: parseFloat(resultado.l) },
                            { label: `Comprimento (${resultado.c})`, value: parseFloat(resultado.c) },
                            { label: `Altura (${resultado.a})`, value: parseFloat(resultado.a) },
                            { label: `Por fardo (${resultado.f})`, value: parseFloat(resultado.f) },
                          ]} />
                        </View>
                      )}
                      {activeTab === 'estoque' && resultado.estoque > 0 && (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {[{ icon: 'package', label: 'Por pinha', value: resultado.totalCeil + ' un', color: T.teal }, { icon: 'layers', label: 'Estoque', value: resultado.estoque + ' un', color: T.blue }, { icon: 'grid', label: 'Pinhas', value: resultado.pinhasNecessarias, color: T.purple }].map((s, i) => (
                            <View key={i} style={{ flex: 1, backgroundColor: T.bgElevated, borderRadius: 13, padding: 10, borderWidth: 1.5, borderColor: s.color + '40', alignItems: 'center' }}>
                              <Feather name={s.icon} size={16} color={s.color} style={{ marginBottom: 5 }} />
                              <Text style={{ fontSize: 8 * fontScale, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', marginBottom: 4, textAlign: 'center' }}>{s.label}</Text>
                              <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: s.color }}>{s.value}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => { reset(); setCalcState(CS.MANUAL); }} style={{ flex: 1, height: 50, borderRadius: 15, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.border, flexDirection: 'row', gap: 7 }}>
                          <Feather name="refresh-cw" size={14} color={T.textSub} />
                          <Text style={{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }}>Recalcular</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleClose} style={{ flex: 1.6, height: 50, borderRadius: 15, backgroundColor: T.teal, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 7, shadowColor: T.teal, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 }}>
                          <Feather name="check-circle" size={16} color="#FFF" />
                          <Text style={{ fontSize: 14 * fontScale, fontWeight: '900', color: '#FFF' }}>Concluído</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};


const RegisterScreen = ({ T, fontScale, onBack, onRegisterSuccess, showErr }) => {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmSenha, setConfirmSenha] = useState('');
  const [perfil, setPerfil] = useState('Repositor');
  const [area, setArea] = useState('bebida');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleRegister = async () => {
    if (!nome.trim() || !email.trim() || !senha.trim()) { showErr('Preencha todos os campos.'); return; }
    if (!isValidEmail(email)) { showErr('E-mail inválido.'); return; }
    if (senha !== confirmSenha) { showErr('As senhas não coincidem.'); return; }
    if (senha.length < 6) { showErr('A senha deve ter pelo menos 6 caracteres.'); return; }
    if (perfil === 'Repositor' && !area) { showErr('Selecione a prateleira do repositor.'); return; }
    setLoading(true);
    try {
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      const rastreio = `cordeiro${randomDigits}`;
      const checkRes = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true&filter__USUARIO__equal=${encodeURIComponent(email)}`);
      if (checkRes.data.results.length > 0) { showErr('E-mail já cadastrado.'); setLoading(false); return; }
      const newUser = { USUARIO: email, SENHA: senha, NOME: nome, PERFIL: perfil, AREA: perfil === 'Repositor' ? area : '', ACESSO: false, RASTREIO: rastreio, LOGINRAPIDO: '', TOKEN_BIOMETRICO: '', UTIMOLOGIN: '' };
      await secureAxiosInstance.post(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`, newUser);
      await addAuditLog('USER_REGISTERED', `Novo cadastro: ${email} (${perfil}) com rastreio ${rastreio}`);
      AppAlert.alert('Cadastro realizado!', `Seu código de rastreio: ${rastreio}\n\nAnote-o para verificar seu acesso. Aguarde aprovação do administrador.`, [{ text: 'OK', onPress: () => onRegisterSuccess() }]);
    } catch (error) { console.error(error); showErr('Erro ao cadastrar. Verifique sua conexão.'); } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 28, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 22 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}><Feather name="arrow-left" size={19} color={T.textSub} /></TouchableOpacity>
          <View>
            <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.purple, letterSpacing: 1.2 }}>NOVO ACESSO</Text>
            <Text style={{ fontSize: 24 * fontScale, fontWeight: '900', color: T.text }}>Criar Cadastro</Text>
          </View>
        </View>
        <View style={{ backgroundColor: T.bgCard, borderRadius: 26, padding: 22, borderWidth: 1, borderColor: T.border }}>
          <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.textSub, letterSpacing: 0.6, marginBottom: 14 }}>DADOS PESSOAIS</Text>
          <View style={{ gap: 12, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 16, paddingLeft: 14 }}>
              <Feather name="user" size={16} color={T.textMuted} />
              <TextInput style={{ flex: 1, padding: 14, paddingLeft: 10, color: T.text, fontSize: 15 }} placeholder="Nome completo" placeholderTextColor={T.textMuted} value={nome} onChangeText={setNome} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 16, paddingLeft: 14 }}>
              <Feather name="mail" size={16} color={T.textMuted} />
              <TextInput style={{ flex: 1, padding: 14, paddingLeft: 10, color: T.text, fontSize: 15 }} placeholder="E-mail" placeholderTextColor={T.textMuted} value={email} onChangeText={v => setEmail(v.toLowerCase())} autoCapitalize="none" keyboardType="email-address" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 16, paddingLeft: 14, paddingRight: 12 }}>
              <Feather name="lock" size={16} color={T.textMuted} />
              <TextInput style={{ flex: 1, padding: 14, paddingLeft: 10, color: T.text, fontSize: 15 }} placeholder="Senha" placeholderTextColor={T.textMuted} secureTextEntry={!showPass} value={senha} onChangeText={setSenha} />
              <TouchableOpacity onPress={() => setShowPass(!showPass)}><Feather name={showPass ? 'eye' : 'eye-off'} size={18} color={T.textSub} /></TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 16, paddingLeft: 14, paddingRight: 12 }}>
              <Feather name="check-square" size={16} color={T.textMuted} />
              <TextInput style={{ flex: 1, padding: 14, paddingLeft: 10, color: T.text, fontSize: 15 }} placeholder="Confirmar senha" placeholderTextColor={T.textMuted} secureTextEntry={!showPass} value={confirmSenha} onChangeText={setConfirmSenha} />
              <TouchableOpacity onPress={() => setShowPass(!showPass)}><Feather name={showPass ? 'eye' : 'eye-off'} size={18} color={T.textSub} /></TouchableOpacity>
            </View>
          </View>
          <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.textSub, letterSpacing: 0.6, marginTop: 14, marginBottom: 12 }}>FUNÇÃO NA EQUIPE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ALL_ROLES.map(r => { const on = perfil === r; return (
              <TouchableOpacity key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: on ? T.blue : T.bgInput, borderWidth: 1, borderColor: on ? T.blue : T.border }} onPress={() => setPerfil(r)}>
                {on && <Feather name="check" size={12} color="#FFF" />}
                <Text style={{ fontWeight: '700', fontSize: 13 * fontScale, color: on ? '#FFF' : T.textSub }}>{roleLabel(r)}</Text>
              </TouchableOpacity>
            ); })}
          </View>
          {perfil === 'Repositor' && (
            <>
              <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.textSub, letterSpacing: 0.6, marginTop: 18, marginBottom: 12 }}>PRATELEIRA DESIGNADA</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{SHELF_KEYS.map(k => { const on = area === k; return (<TouchableOpacity key={k} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, backgroundColor: on ? T.blueGlow : T.bgInput, borderWidth: 1.5, borderColor: on ? T.blue + '60' : T.border }} onPress={() => setArea(k)}><Text style={{ fontWeight: '700', fontSize: 13 * fontScale, color: on ? T.blue : T.textSub }}>{shlabel(k)}</Text></TouchableOpacity>); })}</View>
            </>
          )}
          <PrimaryBtn label={loading ? 'Cadastrando...' : 'Criar Cadastro'} icon={loading ? undefined : 'user-check'} onPress={handleRegister} color={T.blue} style={{ marginTop: 26 }} disabled={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const AdminPanel = ({ T, fontScale, onBack }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedShelfForDelete, setSelectedShelfForDelete] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ── Modal de alerta/feedback interno ────────────────────────────────────────
  const [adminModal, setAdminModal] = useState({ visible: false, type: 'info', title: '', message: '', onConfirm: null, confirmLabel: 'OK', confirmColor: null, cancelLabel: null });
  const showModal = (type, title, message, opts = {}) => setAdminModal({ visible: true, type, title, message, onConfirm: opts.onConfirm || null, confirmLabel: opts.confirmLabel || 'OK', confirmColor: opts.confirmColor || null, cancelLabel: opts.cancelLabel || null });
  const closeModal = () => setAdminModal(p => ({ ...p, visible: false, onConfirm: null }));

  // ── Modal de confirmação de apagar prateleira ────────────────────────────────
  const [deleteShelfModal, setDeleteShelfModal] = useState(false);
  // ── Modal de confirmação de deletar usuário ──────────────────────────────────
  const [deleteUserModal, setDeleteUserModal] = useState({ visible: false, user: null });

  const iconForType = (type) => type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : type === 'confirm' ? 'trash-2' : 'info';
  const colorForType = (type) => type === 'success' ? T.green : type === 'error' ? T.red : type === 'warning' ? T.amber : type === 'confirm' ? T.red : T.blue;
  const bgForType = (type) => type === 'success' ? T.greenGlow : type === 'error' ? T.redGlow : type === 'warning' ? T.amberGlow : type === 'confirm' ? T.redGlow : T.blueGlow;

  useEffect(() => { if (adminAuthenticated) { loadUsers(); Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: false }).start(); } }, [adminAuthenticated, fadeAnim, loadUsers]);
  const loadUsers = useCallback(async () => { setLoading(true); try { const res = await secureAxiosInstance.get('https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true'); setUsers(res.data.results); } catch { showModal('error', 'Erro', 'Não foi possível carregar os colaboradores.'); } finally { setLoading(false); } }, []);
  const toggleAccess = async (user) => { try { await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${user.id}/?user_field_names=true`, { ACESSO: !user.ACESSO }); await addAuditLog('ADMIN_TOGGLE_ACCESS', `Acesso de ${user.USUARIO} alterado para ${!user.ACESSO}`); loadUsers(); } catch { showModal('error', 'Erro', 'Falha ao alterar acesso do colaborador.'); } };
  const changeArea = async (user, newArea) => { try { await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${user.id}/?user_field_names=true`, { AREA: newArea }); await addAuditLog('ADMIN_CHANGE_AREA', `Área de ${user.USUARIO} alterada para ${newArea}`); loadUsers(); } catch { showModal('error', 'Erro', 'Falha ao alterar área.'); } };
  const confirmDeleteUser = (user) => setDeleteUserModal({ visible: true, user });
  const doDeleteUser = async () => { const user = deleteUserModal.user; setDeleteUserModal({ visible: false, user: null }); try { await secureAxiosInstance.delete(`https://api.baserow.io/api/database/rows/table/221009/${user.id}/`); await addAuditLog('ADMIN_DELETE_USER', `Usuário ${user.USUARIO} deletado`); loadUsers(); showModal('success', 'Removido!', `${user.NOME} foi removido com sucesso.`); } catch { showModal('error', 'Erro', 'Não foi possível deletar o colaborador.'); } };
  const confirmDeleteAllProducts = () => { if (!selectedShelfForDelete) { showModal('warning', 'Selecione uma prateleira', 'Toque em uma das prateleiras acima antes de apagar.'); return; } setDeleteShelfModal(true); };
  const doDeleteAllProducts = async () => { setDeleteShelfModal(false); const tableId = SHELVES[selectedShelfForDelete]; if (!tableId) { showModal('error', 'Erro', 'Prateleira inválida.'); return; } setDeleting(true); try { let page = 1; let totalDeleted = 0; while (true) { const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true&size=100&page=${page}`); const rows = res.data?.results || []; if (rows.length === 0) break; for (const row of rows) { await secureAxiosInstance.delete(`https://api.baserow.io/api/database/rows/table/${tableId}/${row.id}/`); totalDeleted++; } if (!res.data?.next) break; page++; } await addAuditLog('ADMIN_DELETE_ALL_PRODUCTS', `${totalDeleted} produtos da prateleira ${selectedShelfForDelete} foram apagados`); setSelectedShelfForDelete(''); showModal('success', 'Prateleira limpa!', `${totalDeleted} produto(s) da prateleira ${shlabel(selectedShelfForDelete || '')} foram removidos com sucesso.`); } catch (error) { showModal('error', 'Erro ao apagar', `Falha ao apagar produtos: ${error?.message || 'Erro desconhecido'}`); } finally { setDeleting(false); } };
  const handleAdminLogin = () => { if (adminPass.trim() === 'cordeiroadmin') { setLoginError(''); setAdminAuthenticated(true); } else { setLoginError('Senha incorreta. Tente novamente.'); } };

  const renderUserItem = ({ item }) => (
    <View style={{ backgroundColor: T.bgCard, borderRadius: 22, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: T.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: item.ACESSO ? T.greenGlow : T.bgInput, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: item.ACESSO ? T.green : T.textMuted }}>{(item.NOME || '?').trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: T.text }} numberOfLines={1}>{item.NOME}</Text>
          <Text style={{ fontSize: 12.5, color: T.textSub }} numberOfLines={1}>{item.USUARIO}</Text>
        </View>
        <Switch value={item.ACESSO} onValueChange={() => toggleAccess(item)} trackColor={{ false: T.border, true: T.green }} thumbColor={item.ACESSO ? T.green : T.textMuted} />
        <TouchableOpacity onPress={() => confirmDeleteUser(item)} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="trash-2" size={16} color={T.red} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: T.bgInput }}><Text style={{ fontSize: 11, fontWeight: '800', color: T.textSub }}>{roleLabel(item.PERFIL)}</Text></View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: T.bgInput }}><Text style={{ fontSize: 11, fontWeight: '800', color: T.textSub }}>{shlabel(item.AREA)}</Text></View>
      </View>
      {item.PERFIL === 'Repositor' && (<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{SHELF_KEYS.map(k => (<TouchableOpacity key={k} onPress={() => changeArea(item, k)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: item.AREA === k ? T.blueGlow : T.bgInput, borderWidth: 1, borderColor: item.AREA === k ? T.blue : T.border }}><Text style={{ fontSize: 10, fontWeight: '700', color: item.AREA === k ? T.blue : T.textSub }}>{shlabel(k)}</Text></TouchableOpacity>))}</View>)}
      {item.RASTREIO && (<Text style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>Rastreio: {item.RASTREIO}</Text>)}
      {item.UTIMOLOGIN && (<Text style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Último login: {item.UTIMOLOGIN}</Text>)}
    </View>
  );

  if (!adminAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 28, borderWidth: 1, borderColor: T.border, shadowColor: T.orange, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.1, shadowRadius: 26, elevation: 8 }}>
          <View style={{ alignItems: 'center', marginBottom: 26 }}>
            <View style={{ width: 76, height: 76, borderRadius: 26, backgroundColor: T.orangeGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 18 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: T.orange, justifyContent: 'center', alignItems: 'center' }}>
                <Feather name="shield" size={24} color="#FFF" />
              </View>
            </View>
            <Text style={{ fontSize: 21, fontWeight: '900', color: T.text, marginBottom: 6 }}>Admin GEI.AI</Text>
            <Text style={{ fontSize: 13, color: T.textSub, textAlign: 'center', lineHeight: 19 }}>Digite a senha de administrador para acessar o painel.</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: loginError ? T.red + '80' : T.border, borderRadius: 16, marginBottom: loginError ? 10 : 20, paddingLeft: 14, paddingRight: 14 }}>
            <Feather name="lock" size={17} color={T.textMuted} />
            <TextInput style={{ flex: 1, padding: 16, paddingLeft: 10, color: T.text, fontSize: 16, fontWeight: '700' }} placeholder="Senha de administrador" placeholderTextColor={T.textSub} secureTextEntry={!showAdminPassword} value={adminPass} onChangeText={v => { setAdminPass(v); if (loginError) setLoginError(''); }} onSubmitEditing={handleAdminLogin} returnKeyType="done" />
            <TouchableOpacity onPress={() => setShowAdminPassword(p => !p)}><Feather name={showAdminPassword ? 'eye' : 'eye-off'} size={19} color={T.textSub} /></TouchableOpacity>
          </View>
          {loginError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: T.redGlow, borderRadius: 14, marginBottom: 16, borderWidth: 1.5, borderColor: T.red + '50' }}>
              <Feather name="alert-circle" size={17} color={T.red} />
              <Text style={{ color: T.red, fontWeight: '800', fontSize: 13, flex: 1 }}>{loginError}</Text>
            </View>
          ) : null}
          <PrimaryBtn label="Acessar Painel" onPress={handleAdminLogin} color={T.blue} fontScale={fontScale || 1} />
          <TouchableOpacity onPress={onBack} style={{ marginTop: 18, alignSelf: 'center', padding: 8 }}>
            <Text style={{ color: T.textSub, fontWeight: '700' }}>← Voltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <TouchableOpacity onPress={onBack} style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center' }}>
          <Feather name="arrow-left" size={20} color={T.textSub} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '900', color: T.text }}>Painel Admin</Text>
        <View style={{ width: 44 }} />
      </View>

      <Animated.ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false} style={{ opacity: fadeAnim }}>
        {/* Seção apagar prateleira */}
        <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 18, marginBottom: 20, borderWidth: 1.5, borderColor: T.red + '30' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center' }}>
              <Feather name="trash-2" size={18} color={T.red} />
            </View>
            <View>
              <Text style={{ fontSize: 15, fontWeight: '900', color: T.text }}>Apagar Prateleira</Text>
              <Text style={{ fontSize: 12, color: T.textSub, fontWeight: '600' }}>Remove TODOS os produtos da prateleira</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {SHELF_KEYS.map(k => (
              <TouchableOpacity key={k} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: selectedShelfForDelete === k ? T.redGlow : T.bgInput, borderWidth: 1.5, borderColor: selectedShelfForDelete === k ? T.red : T.border }} onPress={() => setSelectedShelfForDelete(k)}>
                <Text style={{ fontWeight: '800', fontSize: 13, color: selectedShelfForDelete === k ? T.red : T.textSub }}>{shlabel(k)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedShelfForDelete ? (
            <View style={{ padding: 12, backgroundColor: T.redGlow, borderRadius: 14, borderWidth: 1, borderColor: T.red + '40', marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="alert-triangle" size={15} color={T.red} />
              <Text style={{ color: T.red, fontWeight: '800', fontSize: 12, flex: 1 }}>Selecionado: {shlabel(selectedShelfForDelete)} — todos os produtos serão apagados permanentemente.</Text>
            </View>
          ) : null}
          <TouchableOpacity
            onPress={confirmDeleteAllProducts}
            disabled={deleting}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 16, backgroundColor: deleting ? T.bgInput : T.red, opacity: deleting ? 0.6 : 1 }}>
            {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="trash-2" size={18} color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{deleting ? 'Apagando...' : 'Apagar todos os produtos'}</Text>
          </TouchableOpacity>
        </View>

        {/* Colaboradores */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }}>
            <Feather name="users" size={18} color={T.blue} />
          </View>
          <View>
            <Text style={{ fontSize: 15, fontWeight: '900', color: T.text }}>Colaboradores</Text>
            <Text style={{ fontSize: 12, color: T.textSub, fontWeight: '600' }}>{users.length} cadastrado(s)</Text>
          </View>
          <TouchableOpacity onPress={loadUsers} style={{ marginLeft: 'auto', width: 36, height: 36, borderRadius: 10, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center' }}>
            <Feather name="refresh-cw" size={15} color={T.blue} />
          </TouchableOpacity>
        </View>
        {loading ? <ActivityIndicator color={T.blue} style={{ marginTop: 20 }} /> : (
          <FlatList data={users} keyExtractor={item => item.id.toString()} renderItem={renderUserItem} scrollEnabled={false} />
        )}
      </Animated.ScrollView>

      {/* ── Modal genérico de alerta/feedback ───────────────────────────────── */}
      <Modal visible={adminModal.visible} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 28 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeModal} />
          <View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 28, borderWidth: 1.5, borderColor: T.border, elevation: 20 }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 62, height: 62, borderRadius: 20, backgroundColor: bgForType(adminModal.type), justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                <Feather name={iconForType(adminModal.type)} size={28} color={colorForType(adminModal.type)} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 8 }}>{adminModal.title}</Text>
              <Text style={{ fontSize: 14, color: T.textSub, textAlign: 'center', lineHeight: 21, fontWeight: '600' }}>{adminModal.message}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {adminModal.cancelLabel ? (
                <TouchableOpacity onPress={closeModal} style={{ flex: 1, paddingVertical: 15, borderRadius: 16, backgroundColor: T.bgInput, alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
                  <Text style={{ color: T.textSub, fontWeight: '800', fontSize: 15 }}>{adminModal.cancelLabel}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => { if (adminModal.onConfirm) adminModal.onConfirm(); else closeModal(); }} style={{ flex: adminModal.cancelLabel ? 1 : 0, minWidth: 120, alignSelf: 'center', paddingVertical: 15, paddingHorizontal: 28, borderRadius: 16, backgroundColor: adminModal.confirmColor || colorForType(adminModal.type), alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{adminModal.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal confirmação apagar prateleira ─────────────────────────────── */}
      <Modal visible={deleteShelfModal} transparent animationType="fade" onRequestClose={() => setDeleteShelfModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDeleteShelfModal(false)} />
          <View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 28, borderWidth: 2, borderColor: T.red + '50', elevation: 20 }}>
            <View style={{ alignItems: 'center', marginBottom: 22 }}>
              <View style={{ width: 70, height: 70, borderRadius: 22, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 2, borderColor: T.red + '40' }}>
                <Feather name="alert-triangle" size={32} color={T.red} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 10 }}>Apagar todos os produtos?</Text>
              <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: T.redGlow, borderRadius: 14, borderWidth: 1, borderColor: T.red + '40', marginBottom: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: '900', color: T.red, textAlign: 'center' }}>{shlabel(selectedShelfForDelete)}</Text>
              </View>
              <Text style={{ fontSize: 14, color: T.textSub, textAlign: 'center', lineHeight: 22, fontWeight: '600' }}>Esta ação é <Text style={{ color: T.red, fontWeight: '900' }}>IRREVERSÍVEL</Text>. Todos os produtos cadastrados nesta prateleira serão permanentemente removidos do banco de dados.</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setDeleteShelfModal(false)} style={{ flex: 1, paddingVertical: 16, borderRadius: 18, backgroundColor: T.bgInput, alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}>
                <Text style={{ color: T.textSub, fontWeight: '900', fontSize: 15 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={doDeleteAllProducts} style={{ flex: 1, paddingVertical: 16, borderRadius: 18, backgroundColor: T.red, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Apagar tudo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal confirmação deletar colaborador ───────────────────────────── */}
      <Modal visible={deleteUserModal.visible} transparent animationType="fade" onRequestClose={() => setDeleteUserModal({ visible: false, user: null })}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDeleteUserModal({ visible: false, user: null })} />
          <View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 28, borderWidth: 2, borderColor: T.red + '50', elevation: 20 }}>
            <View style={{ alignItems: 'center', marginBottom: 22 }}>
              <View style={{ width: 70, height: 70, borderRadius: 22, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 2, borderColor: T.red + '40' }}>
                <Feather name="user-x" size={32} color={T.red} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 8 }}>Remover colaborador?</Text>
              {deleteUserModal.user ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: T.bgInput, borderRadius: 14, borderWidth: 1, borderColor: T.border, marginBottom: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: T.text, textAlign: 'center' }}>{deleteUserModal.user.NOME}</Text>
                  <Text style={{ fontSize: 12, color: T.textSub, textAlign: 'center', marginTop: 2 }}>{deleteUserModal.user.USUARIO}</Text>
                </View>
              ) : null}
              <Text style={{ fontSize: 14, color: T.textSub, textAlign: 'center', lineHeight: 22, fontWeight: '600' }}>Este colaborador será <Text style={{ color: T.red, fontWeight: '900' }}>permanentemente deletado</Text>. Essa ação não pode ser desfeita.</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setDeleteUserModal({ visible: false, user: null })} style={{ flex: 1, paddingVertical: 16, borderRadius: 18, backgroundColor: T.bgInput, alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}>
                <Text style={{ color: T.textSub, fontWeight: '900', fontSize: 15 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={doDeleteUser} style={{ flex: 1, paddingVertical: 16, borderRadius: 18, backgroundColor: T.red, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Deletar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const RastreioModal = ({ visible, onClose, T, fontScale }) => {
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const checkRastreio = async () => { if (!codigo.trim()) return; setLoading(true); setResult(null); try { const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true&filter__RASTREIO__equal=${encodeURIComponent(codigo.trim())}`); if (res.data.results.length === 0) { setResult({ success: false, message: 'Código de rastreio não encontrado.' }); } else { const user = res.data.results[0]; if (user.ACESSO) { setResult({ success: true, message: `✅ Acesso liberado! Você pode fazer login com e-mail e senha.` }); } else { setResult({ success: false, message: `⏳ Acesso ainda não liberado pelo administrador. Aguarde aprovação.` }); } } } catch (error) { setResult({ success: false, message: 'Erro ao consultar. Tente novamente.' }); } finally { setLoading(false); } };
  return (<Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} /><View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 24, borderWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 20 * fontScale, fontWeight: '900', color: T.text, marginBottom: 8 }}>Verificar Acesso</Text><Text style={{ fontSize: 14 * fontScale, color: T.textSub, marginBottom: 20 }}>Digite o código de rastreio fornecido no cadastro.</Text><TextInput style={{ backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 14, padding: 16, marginBottom: 20, color: T.text }} placeholder="cordeiroXXXX" value={codigo} onChangeText={setCodigo} autoCapitalize="none" /><PrimaryBtn label={loading ? 'Consultando...' : 'Consultar'} onPress={checkRastreio} color={T.blue} disabled={loading} />{result && (<View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: result.success ? T.greenGlow : T.redGlow, borderWidth: 1, borderColor: result.success ? T.green : T.red }}><Text style={{ color: result.success ? T.green : T.red, fontWeight: '700', textAlign: 'center' }}>{result.message}</Text></View>)}<TouchableOpacity onPress={onClose} style={{ marginTop: 20, alignSelf: 'center' }}><Text style={{ color: T.textSub }}>Fechar</Text></TouchableOpacity></View></View></Modal>);
};

// ─── SMART VOICE ENGINE — NLP COMPLETO PT-BR ────────────────────────────────

// ── Tabela completa de números em português ──────────────────────────────────
const PT_NUM_MAP = {
  'zero':0,'um':1,'uma':1,'dois':2,'duas':2,'tres':3,'três':3,
  'quatro':4,'cinco':5,'seis':6,'sete':7,'oito':8,'nove':9,
  'dez':10,'onze':11,'doze':12,'treze':13,'catorze':14,'quatorze':14,
  'quinze':15,'dezesseis':16,'dezasseis':16,'dezessete':17,'dezoito':18,
  'dezenove':19,'dezanove':19,
  'vinte':20,'trinta':30,'quarenta':40,'cinquenta':50,'cinqüenta':50,
  'sessenta':60,'setenta':70,'oitenta':80,'noventa':90,
  'cem':100,'cento':100,
  'duzentos':200,'duzentas':200,'trezentos':300,'trezentas':300,
  'quatrocentos':400,'quatrocentas':400,'quinhentos':500,'quinhentas':500,
  'seiscentos':600,'seiscentas':600,'setecentos':700,'setecentas':700,
  'oitocentos':800,'oitocentas':800,'novecentos':900,'novecentas':900,
  'mil':1000,'milhao':1000000,
};
const PT_ORDINAL_MAP = {
  'primeiro':1,'primeira':1,'segundo':2,'segunda':2,'terceiro':3,'terceira':3,
  'quarto':4,'quarta':4,'quinto':5,'quinta':5,'sexto':6,'sexta':6,
  'setimo':7,'setima':7,'oitavo':8,'oitava':8,'nono':9,'nona':9,
  'decimo':10,'decima':10,'decimo primeiro':11,'decima primeira':11,
  'decimo segundo':12,'decima segunda':12,'decimo terceiro':13,'decima terceira':13,
  'decimo quarto':14,'decima quarta':14,'decimo quinto':15,'decima quinta':15,
  'decimo sexto':16,'decima sexta':16,'decimo setimo':17,'decima setima':17,
  'decimo oitavo':18,'decima oitava':18,'decimo nono':19,'decima nona':19,
  'vigesimo':20,'vigesima':20,'vigesimo primeiro':21,'vigesima primeira':21,
  'vigesimo segundo':22,'vigesima segunda':22,'vigesimo terceiro':23,
  'vigesimo quarto':24,'vigesimo quinto':25,'vigesimo sexto':26,
  'vigesimo setimo':27,'vigesimo oitavo':28,'vigesimo nono':29,
  'trigesimo':30,'trigesima':30,'trigesimo primeiro':31,'trigesima primeira':31,
};

// ── Converte número para extenso pt-BR — ElevenLabs fala corretamente ─────────
const num_to_words_ptbr = (n) => {
  const units = ['','um','dois','três','quatro','cinco','seis','sete','oito','nove',
    'dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const tens  = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const huns  = ['','cento','duzentos','trezentos','quatrocentos','quinhentos',
    'seiscentos','setecentos','oitocentos','novecentos'];
  if (!n || n === 0) return 'zero';
  if (n === 100) return 'cem';
  let r = '', rem = Math.abs(n);
  if (rem >= 1000) {
    const m = Math.floor(rem / 1000);
    r += (m === 1 ? 'mil' : num_to_words_ptbr(m) + ' mil');
    rem = rem % 1000;
    if (rem) r += ' e ';
  }
  if (rem >= 100) { r += huns[Math.floor(rem/100)]; rem = rem % 100; if (rem) r += ' e '; }
  if (rem >= 20)  { r += tens[Math.floor(rem/10)]; if (rem%10) r += ' e ' + units[rem%10]; }
  else if (rem)   { r += units[rem]; }
  return r;
};

// Converte texto PT-BR em número inteiro (ex: "mil cento e três" → 1103)
const parsePortugueseNumber = (raw) => {
  if (!raw) return null;
  try {
    const s = String(raw).trim().toLowerCase()
      .replace(/[.,]/g,'').replace(/\be\b|\bcom\b|\bde\b/g,' ').replace(/\s+/g,' ').trim();
    const direct = parseInt(s.replace(/\s/g,''), 10);
    if (!isNaN(direct) && /^\d+$/.test(s.replace(/\s/g,''))) return direct;
    for (const [k,v] of Object.entries(PT_ORDINAL_MAP)) { if (s === k) return v; }
    const tokens = s.split(/\s+/).filter(Boolean);
    let total = 0, chunk = 0;
    for (const tok of tokens) {
      const val = PT_NUM_MAP[tok];
      if (val === undefined) { const d = parseInt(tok,10); if (!isNaN(d)) chunk += d; continue; }
      if (val === 1000) { chunk = chunk===0 ? 1 : chunk; total += chunk * 1000; chunk = 0; }
      else { chunk += val; }
    }
    total += chunk;
    return total > 0 ? total : null;
  } catch { return null; }
};

// ── Tabela de meses ──────────────────────────────────────────────────────────
const PT_MONTH_MAP = {
  'janeiro':'01','jan':'01','janero':'01','janiero':'01',
  'fevereiro':'02','fev':'02','feveriro':'02','feverero':'02',
  'marco':'03','marcco':'03','mar':'03','maco':'03','marso':'03',
  'abril':'04','abr':'04','abryl':'04',
  'maio':'05','mai':'05','mao':'05',
  'junho':'06','jun':'06','juho':'06',
  'julho':'07','jul':'07','juio':'07','jullio':'07',
  'agosto':'08','ago':'08','agost':'08',
  'setembro':'09','set':'09','setembr':'09',
  'outubro':'10','out':'10','otubro':'10',
  'novembro':'11','nov':'11','novembr':'11',
  'dezembro':'12','dez':'12','decembro':'12',
};
// Dias escritos por extenso ("onze de maio" → dia 11)
const PT_DAY_WORDS = {
  'um':1,'uma':1,'dois':2,'duas':2,'tres':3,'quatro':4,'cinco':5,
  'seis':6,'sete':7,'oito':8,'nove':9,'dez':10,'onze':11,'doze':12,
  'treze':13,'quatorze':14,'catorze':14,'quinze':15,'dezesseis':16,
  'dezaseis':16,'dezasseis':16,'dezessete':17,'dezassete':17,'dezasete':17,
  'dezoito':18,'dezenove':19,'dezanove':19,'vinte':20,
  'vinte e um':21,'vinte e uma':21,'vinte e dois':22,'vinte e duas':22,
  'vinte e tres':23,'vinte e quatro':24,'vinte e cinco':25,
  'vinte e seis':26,'vinte e sete':27,'vinte e oito':28,'vinte e nove':29,
  'trinta':30,'trinta e um':31,'trinta e uma':31,
};

// Converte expressão de data PT-BR em DD/MM/YYYY — parser inteligente multi-formato
const parsePortugueseDate = (raw) => {
  if (!raw) return null;
  try {
    const curYear = new Date().getFullYear();

    // ── Normalização base ──────────────────────────────────────────────────
    const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let t = strip(String(raw).trim().toLowerCase());

    // Converter anos por extenso antes de tudo
    const yearWords = [
      [/dois mil e vinte e seis/g,'2026'],[/dois mil e vinte e sete/g,'2027'],
      [/dois mil e vinte e oito/g,'2028'],[/dois mil e vinte e nove/g,'2029'],
      [/dois mil e trinta/g,'2030'],[/dois mil e vinte e cinco/g,'2025'],
      [/dois mil e vinte e quatro/g,'2024'],[/dois mil e vinte e tres/g,'2023'],
      [/dois mil e vinte e dois/g,'2022'],[/dois mil e vinte e um/g,'2021'],
      [/dois mil e vinte/g,'2020'],[/dois mil e trinta e um/g,'2031'],
    ];
    for (const [re, v] of yearWords) t = t.replace(re, v);

    // Converter dias por extenso para número (antes de remover preposições)
    const dayWordsSorted = Object.keys(PT_DAY_WORDS).sort((a,b)=>b.length-a.length);
    for (const k of dayWordsSorted) {
      t = t.replace(new RegExp('\\b' + k.replace(/ /g,'\\s+') + '\\b', 'g'), String(PT_DAY_WORDS[k]));
    }

    // Converter ordinais para número
    const ordinalsSorted = Object.keys(PT_ORDINAL_MAP).sort((a,b)=>b.length-a.length);
    for (const k of ordinalsSorted) {
      t = t.replace(new RegExp('\\b' + k.replace(/ /g,'\\s+') + '\\b', 'g'), String(PT_ORDINAL_MAP[k]));
    }

    // Limpar frases de "data de cadastro / registro / entrada / envio do produto"
    // Essas frases ocorrem quando o usuário diz a data de cadastramento de um produto
    t = t
      .replace(/\b(data\s+(de\s+)?(cadastro|cadastramento|registro|entrada|envio|compra|aquisicao|recebimento)(\s+do\s+produto)?)\b/gi, '')
      .replace(/\bdata\b/g, '');

    // Limpar ruído
    t = t
      .replace(/[º°]/g, '')
      .replace(/\b(de|do|da|no|na|em|ao|aos|dia|mes|ano|o|a|para|ate|vence|vencimento|validade|prazo|produto|lote|fabricacao|fabricado|produzido)\b/g, ' ')
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ').trim();

    // ── Helpers ───────────────────────────────────────────────────────────
    const clampDay = (d, m, y) => Math.max(1, Math.min(d, new Date(y, parseInt(m), 0).getDate()));
    const fmt = (d, m, y) => `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    const monthNum = (s) => {
      const key = strip(s.trim().toLowerCase());
      // Pelo nome
      if (PT_MONTH_MAP[key]) return parseInt(PT_MONTH_MAP[key]);
      // Pelo número direto (1-12)
      const n = parseInt(key);
      if (!isNaN(n) && n >= 1 && n <= 12) return n;
      return null;
    };
    // ── nearestYear: devolve o ano mais próximo no futuro para d/m ───────────────────
    // Lógica: se d/m/anoAtual ainda não passou (ou é hoje) → anoAtual
    //         se já passou → anoAtual + 1
    const nearestYear = (d, m) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const candidate = new Date(curYear, m - 1, d);
      return candidate >= today ? curYear : curYear + 1;
    };

    const resolveYear = (s) => {
      let n = parseInt(s);
      if (isNaN(n)) return curYear;
      // Anos de 2 dígitos → 20xx (ex: "26" → 2026)
      if (n >= 0 && n <= 99) return 2000 + n;
      // Anos de 4 dígitos: se caiu no range 2000–2019, o reconhecedor de voz
      // provavelmente ouviu "dezesseis" quando o usuário disse "vinte e seis".
      // Corrigir somando 10 para chegar em 2020+.
      // Ex: 2016 → 2026, 2017 → 2027, 2018 → 2028, 2019 → 2029
      if (n >= 2000 && n < 2020) return n + 10;
      if (n >= 2020 && n <= 2099) return n;
      // Inválido (3 dígitos, > 2099, negativo) → ano atual
      return curYear;
    };

    // ── Estratégia 1: 8 dígitos sem separador DDMMYYYY ────────────────────
    const eightDigits = t.match(/\b(\d{2})(\d{2})(\d{4})\b/);
    if (eightDigits) {
      const d = parseInt(eightDigits[1]), m = parseInt(eightDigits[2]);
      const y = resolveYear(eightDigits[3]); // ✅ corrige 2016→2026 etc.
      if (m >= 1 && m <= 12 && d >= 1) return fmt(clampDay(d,m,y), m, y);
    }

    // ── Estratégia 2: DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY ─────────────
    const sepDate = t.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
    if (sepDate) {
      const d = parseInt(sepDate[1]), m = parseInt(sepDate[2]), y = resolveYear(sepDate[3]);
      if (m >= 1 && m <= 12 && d >= 1) return fmt(clampDay(d,m,y), m, y);
    }

    // ── Estratégia 2b: DD/MM YYYY — separador entre dia/mês mas espaço antes do ano ─
    // Captura "28/06 2026", "28/06 26", "15-03 2027", "05.11 2026"
    const sepSpaceYear = t.match(/(\d{1,2})[\/\.\-](\d{1,2})\s+(\d{2,4})/);
    if (sepSpaceYear) {
      const d = parseInt(sepSpaceYear[1]), m = parseInt(sepSpaceYear[2]), y = resolveYear(sepSpaceYear[3]);
      if (m >= 1 && m <= 12 && d >= 1) return fmt(clampDay(d,m,y), m, y);
    }

    // ── Estratégia 2c: DD MM/YYYY — só o mês tem separador com o ano ──────────
    // Captura "28 06/2026", "28 06/26"
    const daySpaceSep = t.match(/(\d{1,2})\s+(\d{1,2})[\/\.\-](\d{2,4})/);
    if (daySpaceSep) {
      const d = parseInt(daySpaceSep[1]), m = parseInt(daySpaceSep[2]), y = resolveYear(daySpaceSep[3]);
      if (m >= 1 && m <= 12 && d >= 1) return fmt(clampDay(d,m,y), m, y);
    }

    // ── Estratégia 3: três números separados por espaço ──────────────────
    // "05 11 2026" / "5 7 26" / "05 07 2026"
    const threeNums = t.match(/^\s*(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})\s*$/);
    if (threeNums) {
      const d = parseInt(threeNums[1]), m = parseInt(threeNums[2]), y = resolveYear(threeNums[3]);
      if (m >= 1 && m <= 12 && d >= 1) return fmt(clampDay(d,m,y), m, y);
    }

    // ── Estratégia 4: dois números espaçados (dia + mês) ─────────────────
    const twoNums = t.match(/^\s*(\d{1,2})\s+(\d{1,2})\s*$/);
    if (twoNums) {
      const d = parseInt(twoNums[1]), m = parseInt(twoNums[2]);
      if (m >= 1 && m <= 12 && d >= 1) { const y4 = nearestYear(d, m); return fmt(clampDay(d,m,y4), m, y4); }
    }

    // ── Estratégia 5: dia (nº) + nome_mês + ano opcional ─────────────────
    // "5 junho 2026" / "5 junho" / "5 jun 2026"
    const monthKeys = Object.keys(PT_MONTH_MAP).sort((a,b)=>b.length-a.length);
    let month = null, monthStart = -1, monthEnd = -1;
    for (const k of monthKeys) {
      const idx = t.indexOf(k);
      if (idx >= 0) { month = parseInt(PT_MONTH_MAP[k]); monthStart = idx; monthEnd = idx + k.length; break; }
    }

    if (month) {
      // Detectar dia (número antes do mês)
      const beforeMonth = t.substring(0, monthStart).trim();
      const afterMonth  = t.substring(monthEnd).trim();

      // Ano (número 4 dígitos ou 2 dígitos depois do mês)
      let year = nearestYear(1, month); // padrão: próxima ocorrência do mês
      const yAfter = afterMonth.match(/\b(\d{2,4})\b/);
      if (yAfter) year = resolveYear(yAfter[1]);
      else {
        const yGlobal = t.match(/\b(20[2-9]\d)\b/);
        if (yGlobal) year = parseInt(yGlobal[1]);
        else {
          const y2 = t.match(/\b([2-9]\d)\b/);
          if (y2 && parseInt(y2[1]) > 24) year = 2000 + parseInt(y2[1]);
        }
      }

      // Dia: tenta número
      let day = 1;
      const dayNum = beforeMonth.match(/(\d{1,2})\s*$/);
      if (dayNum) {
        day = parseInt(dayNum[1]);
      } else if (beforeMonth.length === 0) {
        // Só mês → dia 1
        day = 1;
      } else {
        // Tentar número em qualquer parte antes
        const anyNum = t.match(/^\s*(\d{1,2})\b/);
        if (anyNum) day = parseInt(anyNum[1]);
      }

      // "ultimo" → último dia do mês
      if (t.includes('ultimo')) day = new Date(year, month, 0).getDate();

      // Se o ano não foi explicitado pelo usuário (veio do nearestYear(1,m)),
      // recalcula com o dia real para garantir que a data não está no passado.
      const hasExplicitYear = !!(yAfter || t.match(/\b(20[2-9]\d)\b/) || (t.match(/\b([2-9]\d)\b/) && parseInt((t.match(/\b([2-9]\d)\b/) || [])[1]) > 24));
      if (!hasExplicitYear) year = nearestYear(clampDay(day, month, year), month);

      return fmt(clampDay(day, month, year), month, year);
    }

    // ── Estratégia 6: só ano falado com 4 dígitos → usa ano, mês 1, dia 1 ─
    // (Raramente útil, mas evita retornar null desnecessariamente)

    return null;
  } catch { return null; }
};

// ── Normalização completa de texto de voz ────────────────────────────────────
const normalizeVoiceInput = (raw) => {
  if (!raw) return '';
  try {
    let t = String(raw).trim();
    const FIXES = [
      // Wake words / app
      
      // Correções inteligentes de termos
      // NOTA: \bmedio\b NÃO deve ser corrigido para "remédio" — conflito com "médio giro"
      [/\bremedio\b/gi, 'remédio'],
      [/\bquantid\b/gi, 'quantidade'],
      [/\bvencim\b/gi, 'vencimento'],
      [/\bgei\s+a[ií]\b/gi,'GEI'],
      [/\bge[iy]\b/gi,'GEI'],
      // Compostos vinte-e-algo → número
      [/\bvinte\s+e\s+um[a]?\b/gi,'21'],
      [/\bvinte\s+e\s+dois\b/gi,'22'],[/\bvinte\s+e\s+duas\b/gi,'22'],
      [/\bvinte\s+e\s+tr[eê]s\b/gi,'23'],
      [/\bvinte\s+e\s+quatro\b/gi,'24'],
      [/\bvinte\s+e\s+cinco\b/gi,'25'],
      [/\bvinte\s+e\s+seis\b/gi,'26'],
      [/\bvinte\s+e\s+sete\b/gi,'27'],
      [/\bvinte\s+e\s+oito\b/gi,'28'],
      [/\bvinte\s+e\s+nove\b/gi,'29'],
      [/\btrinta\s+e\s+uma?\b/gi,'31'],
      [/\bdois\s+mil\b/gi,'2000'],
      [/\btr[eê]s\s+mil\b/gi,'3000'],
      [/\bquatro\s+mil\b/gi,'4000'],
      [/\bcinco\s+mil\b/gi,'5000'],
      // Medidas
      [/(\d+)\s*gramas?\b/gi,'$1g'],
      [/(\d+)\s*quilos?\b/gi,'$1kg'],
      [/(\d+)\s*litros?\b/gi,'$1L'],
      [/(\d+)\s*mililitros?\b/gi,'$1ml'],
      // Anos falados por extenso — converter ANTES das datas (ex: "dois mil e vinte e seis" → "2026")
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+um\b/gi,   '2021'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+dois\b/gi,  '2022'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+tres\b/gi,  '2023'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+tr[eê]s\b/gi,'2023'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+quatro\b/gi,'2024'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+cinco\b/gi, '2025'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+seis\b/gi,  '2026'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+sete\b/gi,  '2027'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+oito\b/gi,  '2028'],
      [/\bdois\s+mil\s+e\s+vinte\s+e\s+nove\b/gi,  '2029'],
      [/\bdois\s+mil\s+e\s+trinta\b/gi,             '2030'],
      [/\bdois\s+mil\s+e\s+vinte\b/gi,              '2020'],
      // Dias ordinais por extenso ("primeiro de maio" → "1 de maio")
      [/\bprimeiro\b/gi,'1'],[/\bsegundo\b/gi,'2'],[/\bterceiro\b/gi,'3'],
      // Datas: todas as formas possiveis
      // "11 de julho de 2026" / "11 julho 2026"
      [/(\d{1,2})\s+(?:de\s+)?([a-záàâãéêíóôõú]+)\s+(?:de\s+)?(20\d{2}|\d{2})\b/gi, (_, d, m, y) => parsePortugueseDate(`${d} ${m} ${y}`) || _],
      [/(\d{1,2})\s+(?:de\s+)?([a-záàâãéêíóôõú]+)/gi, (_, d, m) => parsePortugueseDate(`${d} ${m}`) || _],
      // Tres numeros seguidos: "05 11 2026" / "5 7 26"
      [/\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2}|\d{2})\b/g, (_, d, m, y) => { const r = parsePortugueseDate(`${d} ${m} ${y}`); return r || _; }],
      // Mês + ano: "junho 2026" → data
      [/\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(20\d{2}|\d{2})\b/gi, (_, m, y) => parsePortugueseDate(`${m} ${y}`) || _],
      // Só mês falado
      [/\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi, (_, m) => parsePortugueseDate(m) || _],
    ];
    for (const [re, rep] of FIXES) {
      try { t = t.replace(re, rep); } catch { /* ignora */ }
    }
    return t;
  } catch { return raw; }
};

// ── Detecção de comando "Novidades" / "Qual é a boa" ────────────────────────
const detectNovidades = (text) => {
  if (!text) return false;
  const n = stripAccents(text);
  return /(novidade|novidades|boa|boas|resumo|resumos|novidade do estoque|me conta|me fala|relatorio|relatorio do estoque|o que tem|quais produtos|produtos vencendo|vencimentos|status do estoque|qual a boa|qual e a boa|qual e a novidade|como esta o estoque|como ta o estoque)/.test(n);
};

// ── Detecção de comando de lembrete por voz ────────────────────────────────
const detectLembreteCmd = (text) => {
  if (!text) return false;
  const n = stripAccents(text.toLowerCase());
  return /(criar lembrete|novo lembrete|adicionar lembrete|lembrete novo|me lembra|me avisa|agenda lembrete|quero um lembrete|cria lembrete|me lembre)/.test(n);
};

// ── Extrai texto de lembrete de frases como "me lembre de passar data amanhã" ──
const extractLembreteTexto = (text) => {
  if (!text) return '';
  const t = text.trim();
  // Tenta extrair o que vem depois de palavras-gatilho
  const match = t.match(/(?:me lembra(?:r)?|me lembre(?:\s+de)?|me avisa(?:r)?|lembrete de|lembrete:|cria(?:r)? lembrete|novo lembrete|adicionar lembrete)\s+(.+)/i);
  if (match) return match[1].trim();
  return t;
};

// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE TERÇAS-FEIRAS: aviso semanal automático de produtos quase vencendo
// Agenda toda terça-feira às 08:00 uma notificação falada com a lista
// ─────────────────────────────────────────────────────────────────────────────
const TERCA_NOTIF_ID_KEY = 'GEI_TercaNotifId';
const TERCA_CHANNEL_ID   = 'terca_vencimento';

const initTercaChannel = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TERCA_CHANNEL_ID, {
      name: '📅 Aviso de Terça-Feira',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 200, 300],
      sound: true,
    });
  }
};

// Calcula a próxima terça-feira às 08:00
const proximaTerca = (hora = 8, min = 0) => {
  const now = new Date();
  const d = new Date(now);
  // dia 2 = terça (0=dom, 1=seg, 2=ter...)
  const diasAteProximaTerca = (2 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diasAteProximaTerca);
  d.setHours(hora, min, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 7); // se já passou, próxima semana
  return d;
};

// Monta o texto do aviso de terça com os produtos quase vencendo
const buildTercaMsg = (stockData) => {
  if (!stockData || stockData.length === 0) return null;
  const agora = new Date(); agora.setHours(0,0,0,0);
  const parseD = s => { if (!s) return null; const [d,m,y]=String(s).split('/'); const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`); return isNaN(dt)?null:dt; };
  const urgentes = stockData.filter(p => {
    const dt = parseD(p.VENCIMENTO || p.validade);
    if (!dt) return false;
    const dias = Math.floor((dt - agora) / 86400000);
    return dias >= 0 && dias <= 15;
  }).sort((a, b) => {
    const da = parseD(a.VENCIMENTO || a.validade);
    const db = parseD(b.VENCIMENTO || b.validade);
    return (da || 0) - (db || 0);
  });
  if (urgentes.length === 0) return null;
  const nomes = urgentes.slice(0, 5).map(p => {
    const dt = parseD(p.VENCIMENTO || p.validade);
    const dias = Math.floor((dt - agora) / 86400000);
    const nome = (p.produto || p.nome || 'Produto').split('·')[0].trim();
    return `${nome}, vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
  });
  const resto = urgentes.length > 5 ? ` e mais ${urgentes.length - 5} outros` : '';
  return `Atenção! Hoje é terça-feira, dia de passar data. Produtos quase vencendo: ${nomes.join('; ')}${resto}. Corra para passar a data!`;
};

// Agenda (ou re-agenda) a notificação semanal de terça
const agendarTercaSemanal = async (stockData) => {
  if (Platform.OS === 'web') return null; // IDB readonly error na web
  try {
    const granted = await requestNotifPermission();
    if (!granted) return;
    await initTercaChannel();
    // Cancela anterior se houver
    const oldId = await SafeStore.getItemAsync(TERCA_NOTIF_ID_KEY);
    if (oldId) { try { await Notifications.cancelScheduledNotificationAsync(oldId); } catch { /* noop */ } }

    const msg = buildTercaMsg(stockData);
    const body = msg || 'Hoje é terça-feira! Lembre-se de verificar as datas dos produtos no estoque.';
    const nextTerca = proximaTerca(8, 0);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '📅 GEI.AI — Dia de Passar Data!',
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { tipo: 'terca_semanal', stockCount: stockData?.length || 0 },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: nextTerca,
        channelId: TERCA_CHANNEL_ID,
      },
    });
    await SafeStore.setItemAsync(TERCA_NOTIF_ID_KEY, id);
    console.log(`[TERÇA] Notificação agendada para ${nextTerca.toLocaleString('pt-BR')}`);
    return id;
  } catch (e) {
    console.warn('[TERÇA] Falha ao agendar:', e?.message);
    return null;
  }
};

// Verifica se hoje é terça e fala o aviso via ElevenLabs (chamado no boot)
const verificarTercaHoje = async (stockData) => {
  const hoje = new Date().getDay(); // 2 = terça
  if (hoje !== 2) return false;
  const KEY = 'GEI_TercaFaladaHoje';
  const ultimaData = await SafeStore.getItemAsync(KEY);
  const hoje_str = new Date().toLocaleDateString('pt-BR');
  if (ultimaData === hoje_str) return false; // já falou hoje
  const msg = buildTercaMsg(stockData);
  if (!msg) return false;
  await SafeStore.setItemAsync(KEY, hoje_str);
  // Fala após 3s do boot para não sobrepor outras falas
  setTimeout(() => speakWithElevenLabs(msg, () => {}), 3000);
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// ALERTA DE RUPTURA POR VELOCIDADE DE CONSUMO — notificação proativa
// Calcula, para cada produto, quantos dias restam até o estoque zerar (usando
// o mesmo motor de previsão do Painel Inteligente: buildDepletionMetrics) e
// dispara uma notificação push automática quando há itens em risco crítico
// (≤15% do estoque restante, mesmo critério usado na aba "Ruptura" do app).
// Roda no máximo 1x por dia POR PRATELEIRA, para não espamar o usuário a cada
// ciclo do polling de 8s — usa SafeStore para lembrar a última data avisada.
// ─────────────────────────────────────────────────────────────────────────────
const RUPTURA_CHANNEL_ID = 'risco_ruptura';
const initRupturaChannel = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(RUPTURA_CHANNEL_ID, {
      name: '📉 Risco de Ruptura de Estoque',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      sound: true,
    });
  }
};
const buildRupturaMsg = (stockData, fifoMode, shelfLabel) => {
  if (!stockData || stockData.length === 0) return null;
  const riscos = stockData
    .map(p => ({ p, m: buildDepletionMetrics(p, fifoMode, stockData, p.codig) }))
    .filter(({ m }) => m && m.remainingPct <= 15 && m.remainingQty > 0)
    .sort((a, b) => a.m.remainingDays - b.m.remainingDays);
  if (riscos.length === 0) return null;
  const nomes = riscos.slice(0, 4).map(({ p, m }) => {
    const nome = String(p.produto || p.nome || 'Produto').split('·')[0].trim();
    return `${nome} (${m.remainingQty}un, ~${m.remainingDays}d)`;
  });
  const resto = riscos.length > 4 ? ` e mais ${riscos.length - 4} produto${riscos.length - 4 !== 1 ? 's' : ''}` : '';
  return {
    count: riscos.length,
    body: `${shelfLabel}: ${nomes.join(', ')}${resto} podem faltar em breve. Hora de repor!`,
  };
};
const verificarRupturaHoje = async (stockData, fifoMode, shelf, shelfLabel) => {
  if (Platform.OS === 'web' || !shelf) return false;
  try {
    const KEY = `GEI_RupturaAvisadaHoje_${shelf}`;
    const ultimaData = await SafeStore.getItemAsync(KEY);
    const hoje_str = new Date().toLocaleDateString('pt-BR');
    if (ultimaData === hoje_str) return false; // já avisou esta prateleira hoje
    const info = buildRupturaMsg(stockData, fifoMode, shelfLabel);
    if (!info) return false;
    const granted = await requestNotifPermission();
    if (!granted) return false;
    await initRupturaChannel();
    await SafeStore.setItemAsync(KEY, hoje_str);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📉 GEI.AI — Risco de Ruptura de Estoque',
        body: info.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: { tipo: 'risco_ruptura', shelf, count: info.count },
      },
      trigger: Platform.OS === 'android' ? { channelId: RUPTURA_CHANNEL_ID } : null,
    });
    return true;
  } catch (e) {
    console.warn('[RUPTURA] Falha ao verificar/avisar:', e?.message);
    return false;
  }
};

// ── Utilidades de notificação de vencimento ──────────────────────────────────
const NOTIF_CHANNEL_ID = 'vencimento_produtos';
const initNotifChannel = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIF_CHANNEL_ID, {
      name: 'Vencimento de Produtos',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
};
// ── requestNotifPermission — verifica status real antes de pedir ─────────────
// Se já foi concedida: retorna true sem chamar o dialog.
// Se `canAskAgain` for false (usuário negou definitivamente): retorna false
//   e oferece abertura das configurações do sistema.
// Se ainda não foi perguntado: pede via requestPermissionsAsync.
const requestNotifPermission = async () => {
  try {
    if (Platform.OS === 'web') {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
    // Native (iOS / Android)
    const { status: existing, canAskAgain } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    if (!canAskAgain) {
      // Permissão bloqueada — só configurações do sistema podem desbloquear
      AppAlert.alert(
        '🔔 Notificações bloqueadas',
        'Você bloqueou as notificações anteriormente. Para receber avisos de vencimento e lembretes, abra as Configurações do dispositivo e ative as notificações para o GEI.AI.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir Configurações', onPress: () => { try { Linking.openSettings(); } catch { /* noop */ } } },
        ]
      );
      return false;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
};
const scheduleVencimentoNotif = async (produto, vencimentoStr) => {
  return await scheduleVencimentoNotifCustom(produto, vencimentoStr, 15, '10:00');
};
const cancelNotifById = async (notifId) => {
  try { await Notifications.cancelScheduledNotificationAsync(notifId); } catch { /* noop */ }
};
const LEMBRETES_STORE_KEY = 'GEI_Lembretes';
const getLembretes = async () => {
  try { const r = await SafeStore.getItemAsync(LEMBRETES_STORE_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
};
const saveLembretes = async (list) => {
  try { await SafeStore.setItemAsync(LEMBRETES_STORE_KEY, JSON.stringify(list)); } catch { /* noop */ }
};

// ── Utilitário: agendar notificação em horário específico ────────────────────
const scheduleVencimentoNotifCustom = async (produto, vencimentoStr, diasAntes = 15, horario = '10:00') => {
  // expo-notifications usa IndexedDB na web e causa "readonly transaction" error — skip silenciosamente
  if (Platform.OS === 'web') return null;
  const [d, m, y] = String(vencimentoStr || '').split('/');
  if (!d || !m || !y) return null;
  const [hora, min] = String(horario).split(':').map(Number);
  const venc = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00`);
  const notifDate = new Date(venc.getTime() - diasAntes * 24 * 60 * 60 * 1000);
  notifDate.setHours(isNaN(hora) ? 10 : hora, isNaN(min) ? 0 : min, 0, 0);
  if (notifDate <= new Date()) return null;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ GEI.AI — Produto Vencendo!',
        body: `${produto} vence em ${vencimentoStr}. Faltam ${diasAntes} dias!`,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { produto, vencimento: vencimentoStr, tipo: 'vencimento' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifDate,
        channelId: NOTIF_CHANNEL_ID,
      },
    });
    return id;
  } catch (e) {
    console.warn('[NOTIF] Falha ao agendar:', e.message);
    return null;
  }
};

// ── Agendador de lembrete personalizado por voz/texto ────────────────────────
const scheduleCustomLembrete = async (texto, horario = '10:00', dataStr = null) => {
  if (Platform.OS === 'web') return null; // IDB readonly error na web
  const [hora, min] = String(horario).split(':').map(Number);
  let notifDate;
  if (dataStr) {
    const [d, m, y] = String(dataStr).split('/');
    notifDate = new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`);
    notifDate.setHours(isNaN(hora) ? 10 : hora, isNaN(min) ? 0 : min, 0, 0);
  } else {
    notifDate = new Date();
    notifDate.setHours(isNaN(hora) ? 10 : hora, isNaN(min) ? 0 : min, 0, 0);
    if (notifDate <= new Date()) {
      // Agenda para amanhã se a hora já passou hoje
      notifDate.setDate(notifDate.getDate() + 1);
    }
  }
  if (notifDate <= new Date()) return null;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 GEI.AI — Lembrete',
        body: texto,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: { tipo: 'personalizado', texto },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifDate,
        channelId: NOTIF_CHANNEL_ID,
      },
    });
    return id;
  } catch { return null; }
};

// ── Parse de horário falado em voz — parser completo com períodos e minutos ──
const parseHorarioVoz = (text) => {
  if (!text) return null;
  const t = stripAccents(text.toLowerCase()).trim();

  // ── Mapa de horas por extenso (mais compridos primeiro para evitar match parcial) ──
  const hrMap = {
    'meia noite':0, 'meia-noite':0, 'midnight':0,
    'vinte e tres':23, 'vinte e tres horas':23,
    'vinte e duas':22, 'vinte e dois':22,
    'vinte e uma':21, 'vinte e um':21,
    'vinte':20,
    'dezanove':19, 'dezenove':19,
    'dezoito':18,
    'dezassete':17, 'dezessete':17,
    'dezasseis':16, 'dezeseis':16, 'dezesseis':16,
    'quinze':15, 'catorze':14, 'quatorze':14, 'treze':13,
    'meio dia':12, 'meio-dia':12, 'doze':12,
    'onze':11, 'dez':10, 'nove':9, 'oito':8, 'sete':7, 'seis':6,
    'cinco':5, 'quatro':4, 'tres':3, 'duas':2, 'dois':2,
    'uma':1, 'um':1, 'zero':0,
  };

  // ── Mapa de minutos por extenso (mais compridos primeiro) ────────────────
  const minMap = [
    ['cinquenta e cinco',55],['cinquenta',50],
    ['quarenta e cinco',45],['tres quartos',45],
    ['quarenta',40],['trinta e cinco',35],
    ['trinta',30],['meia',30],
    ['vinte e cinco',25],['vinte',20],
    ['quinze',15],['um quarto',15],
    ['dez',10],['cinco',5],
  ];

  // ── Detecta período do dia ────────────────────────────────────────────────
  const isManha = /\b(manha|madrugada|am)\b/.test(t);
  const isTarde = /\b(tarde|pm)\b/.test(t);
  const isNoite = /\b(noite)\b/.test(t);

  // ── Aplica período → converte para formato 24h ───────────────────────────
  const applyPeriod = (h, m) => {
    let hour = h;
    if ((isTarde || isNoite) && hour > 0 && hour < 12) hour += 12;
    if (isManha && hour === 12) hour = 0; // "doze da manha" → 00:00
    return `${String(Math.min(hour, 23)).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  };

  // ── Extrai minutos de uma substring (depois da hora) ─────────────────────
  const getMinutes = (str) => {
    for (const [k, v] of minMap) if (str.includes(k)) return v;
    // "e XX" — número direto de minutos
    const mE = str.match(/\be\s+(\d{1,2})\b/);
    if (mE) { const n = parseInt(mE[1]); if (n >= 0 && n <= 59) return n; }
    return 0;
  };

  // ── 1. Formato digital "14:30", "14h30", "14h" ───────────────────────────
  const mDig = t.match(/(\d{1,2})[h:](\d{2})/);
  if (mDig) {
    const h = parseInt(mDig[1]), min = parseInt(mDig[2]);
    if (h <= 23 && min <= 59) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  const mDigH = t.match(/\b(\d{1,2})h\b/);
  if (mDigH) {
    const h = parseInt(mDigH[1]);
    if (h <= 23) return applyPeriod(h, 0);
  }

  // ── 2. Hora por extenso com potenciais minutos após ───────────────────────
  // Ordena chaves por comprimento desc para evitar match prematuro de "dez" em "dezoito"
  const hrKeys = Object.keys(hrMap).sort((a, b) => b.length - a.length);
  for (const k of hrKeys) {
    const idx = t.indexOf(k);
    if (idx >= 0) {
      const h = hrMap[k];
      // Procura minutos APENAS no trecho após a palavra da hora
      const afterHour = t.substring(idx + k.length);
      const mins = getMinutes(afterHour);
      return applyPeriod(h, mins);
    }
  }

  // ── 3. Número digital + período ("8 horas da tarde", "as 14", "as 8 da manha") ─
  const mHoras = t.match(/(?:a[os]?\s+)?(\d{1,2})\s*(?:hora[s]?)\b/);
  if (mHoras) {
    const h = parseInt(mHoras[1]);
    if (h <= 23) return applyPeriod(h, getMinutes(t.substring(t.indexOf(mHoras[0]) + mHoras[0].length)));
  }
  const mNum = t.match(/\b(?:a[os]\s+)?(\d{1,2})\b/);
  if (mNum) {
    const h = parseInt(mNum[1]);
    if (h >= 0 && h <= 23) return applyPeriod(h, getMinutes(t.substring(t.indexOf(mNum[0]) + mNum[0].length)));
  }

  return null;
};

// ── Estado global para lembretes personalizados aguardando horário ────────
let _pendingCustomLembreteTexto = null;

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: NovidadesModal — REDESIGN COMPLETO
// Painel bonito, 3 abas, lembretes visuais, anti-duplicata, horário por voz
// ─────────────────────────────────────────────────────────────────────────────
const NovidadesModal = ({ visible, onClose, stockData, T, fontScale, userData, embedded }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping]   = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lembretes, setLembretes] = useState([]);
  const [autoAgendado, setAutoAgendado] = useState(false);
  const [activeTab, setActiveTab] = useState('resumo');
  const [novoTexto, setNovoTexto]     = useState('');
  const [novoHorario, setNovoHorario] = useState('10:00');
  const [novoData, setNovoData]       = useState('');
  const [salvando, setSalvando]       = useState(false);
  const [ouvinHorario, setOuvindoHor] = useState(false);
  const [lembreteErr, setLembreteErr] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [similarConfirm, setSimilarConfirm] = useState(null);
  const [saveAnim]                    = useState(new Animated.Value(0));
  const typingTimerRef = useRef(null);
  const isMountedRef   = useRef(false);
  const slideA         = useRef(new Animated.Value(WIN.height)).current;
  const opacA          = useRef(new Animated.Value(0)).current;
  const tabLineA       = useRef(new Animated.Value(0)).current;
  const avatarPulseA   = useRef(new Animated.Value(1)).current;
  const dotPulseA      = useRef(new Animated.Value(0.5)).current;
  const avatarLoopRef  = useRef(null);
  const nomeUsuario    = userData?.NOME?.split(' ')?.[0] || 'você';

  // ── Typewriter ───────────────────────────────────────────────────────────
  const typeText = useCallback((text) => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setDisplayedText(''); setIsTyping(true);
    let i = 0;
    const tick = () => {
      if (!isMountedRef.current) return;
      i++;
      setDisplayedText(text.slice(0, i));
      if (i < text.length) typingTimerRef.current = setTimeout(tick, 14);
      else { setIsTyping(false); speakWithElevenLabs(text, () => {}); }
    };
    typingTimerRef.current = setTimeout(tick, 60);
  }, []);

  // ── Animação da tab selecionada ─────────────────────────────────────────
  const TABS = [
    { key:'resumo',    icon:'cpu',            label:'Resumo IA',  color: T.purple },
    { key:'lembretes', icon:'bell',           label:'Lembretes',  color: T.amber },
    { key:'novo',      icon:'plus-circle',    label:'Criar',      color: T.green },
  ];
  const tabIdx = TABS.findIndex(t => t.key === activeTab);
  useEffect(() => {
    Animated.spring(tabLineA, { toValue: tabIdx, tension: 80, friction: 12, useNativeDriver: false }).start();
  }, [tabIdx, tabLineA]);
  const tabLineLeft = tabLineA.interpolate({ inputRange: [0,1,2], outputRange: ['0%','33.33%','66.66%'] });

  // ── Geração do resumo ────────────────────────────────────────────────────
  const gerarResumo = useCallback(async (stock) => {
    if (!stock || stock.length === 0) { typeText(`Tudo certo, ${nomeUsuario}! Nenhum produto cadastrado ainda. 📦`); return; }
    setIsLoading(true); setDisplayedText('');
    const agora = new Date(); agora.setHours(0,0,0,0);
    const parseD = s => { if (!s) return null; const [d,m,y]=String(s).split('/'); const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`); return isNaN(dt)?null:dt; };
    const getVal = p => p.VENCIMENTO||p.validade||'';
    const venc  = stock.filter(p=>{const dt=parseD(getVal(p));return dt&&dt<agora;});
    const r7    = stock.filter(p=>{const dt=parseD(getVal(p));if(!dt)return false;const d=Math.floor((dt-agora)/86400000);return d>=0&&d<=7;});
    const r15   = stock.filter(p=>{const dt=parseD(getVal(p));if(!dt)return false;const d=Math.floor((dt-agora)/86400000);return d>7&&d<=15;});
    const r30   = stock.filter(p=>{const dt=parseD(getVal(p));if(!dt)return false;const d=Math.floor((dt-agora)/86400000);return d>15&&d<=30;});
    const obj = { nomeUsuario, total:stock.length,
      vencidos:venc.map(p=>`${p.produto||p.nome} (${getVal(p)})`),
      em7:r7.map(p=>`${p.produto||p.nome} — vence ${getVal(p)}`),
      em15:r15.map(p=>`${p.produto||p.nome} — vence ${getVal(p)}`),
      em30:r30.map(p=>`${p.produto||p.nome} — vence ${getVal(p)}`),
    };
    const prompt = `Você é o GEI (Gestão de Estoque Inteligente), com a personalidade e elegância do JARVIS. 
    Gere um resumo do estoque para o usuário "${nomeUsuario}". 
    REGRAS:
    1. Seja criativo e VARIE as frases. Nunca use a mesma estrutura.
    2. Use um tom proativo, inteligente e levemente sofisticado.
    3. Se houver produtos vencendo em até 15 dias, mencione que as notificações foram configuradas.
    4. Mantenha CURTO (máximo 5-6 linhas).
    5. Use emojis pertinentes.
    6. Dados atuais: ${JSON.stringify(obj)}`;

    try {
      await initializeSecureTokens();
      let txt = null;
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{ 
          method:'POST', 
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`}, 
          body:JSON.stringify({
            model:'llama-3.3-70b-versatile',
            messages:[
              {role:'system', content:'Você é um assistente de IA sofisticado tipo Jarvis. Nunca repita saudações padrões. Seja dinâmico.'},
              {role:'user', content:prompt}
            ],
            max_tokens:400,
            temperature:0.85 // Aumentado para mais aleatoriedade
          }) 
        });
        const d = await r.json(); txt = d?.choices?.[0]?.message?.content?.trim();
      } catch { /* fallback Gemini */ }
      if (!txt) { try { txt = await callGeminiOptimized(prompt, false); } catch { /* noop */ } }
      if (isMountedRef.current) typeText(txt || _resumoLocal(obj));
    } catch { if (isMountedRef.current) typeText(_resumoLocal(obj)); }
    finally  { if (isMountedRef.current) setIsLoading(false); }
  }, [nomeUsuario, typeText]);

  const _resumoLocal = r => {
    const greetings = [
      `Olá, ${r.nomeUsuario}! Analisando os sensores de estoque...`,
      `Saudações, ${r.nomeUsuario}. Relatório de inventário processado.`,
      `Tudo pronto, ${r.nomeUsuario}. Aqui está o panorama atual:`,
      `Sistema GEI online. ${r.nomeUsuario}, veja os pontos de atenção:`
    ];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];

    if (!r.vencidos.length && !r.em7.length && !r.em15.length && !r.em30.length) {
      const okMsgs = [
        `Tudo em ordem por aqui. ${r.total} itens monitorados e sem urgências. ✅`,
        `Estoque impecável, ${r.nomeUsuario}. Nenhuma expiração próxima detectada entre os ${r.total} itens.`,
        `Sensores indicam estabilidade total. ${r.total} produtos em conformidade.`
      ];
      return `${greeting}\n\n${okMsgs[Math.floor(Math.random() * okMsgs.length)]}`;
    }

    let t = `${greeting}\n`;
    if (r.vencidos.length) t += `\n💀 ATENÇÃO: ${r.vencidos.length} itens já expiraram.`;
    if (r.em7.length)      t += `\n🔴 Crítico: ${r.em7.length} produtos vencem esta semana.`;
    if (r.em15.length)     t += `\n🟠 Alerta: ${r.em15.length} itens com validade em 15 dias.`;
    if (r.em30.length)     t += `\n🟡 Monitorando: ${r.em30.length} itens para o próximo mês.`;
    
    t += `\n\nTotal de ${r.total} itens sob minha supervisão.`;
    return t;
  };

  // ── Auto-agenda lembretes (com anti-duplicata completo) ──────────────────
  const autoAgendarLembretes = useCallback(async (stock) => {
    if (!stock||stock.length===0||autoAgendado) return;
    const granted = await requestNotifPermission();
    if (!granted) return;
    await initNotifChannel();
    const agora = new Date(); agora.setHours(0,0,0,0);
    const existentes = await getLembretes();
    // Remove expirados
    const ativos = [];
    for (const l of existentes) {
      if (l.tipo!=='auto') { ativos.push(l); continue; }
      const [d,m,y]=String(l.validade||'').split('/');
      const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`);
      const dias=isNaN(dt)?999:Math.floor((dt-agora)/86400000);
      if (dias<-1) { await cancelNotifById(l.notifId); }
      else ativos.push(l);
    }
    const novos=[];
    for (const p of stock) {
      const nome=p.produto||p.nome||'Produto', val=p.VENCIMENTO||p.validade||'';
      const [d,m,y]=String(val).split('/');
      const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`);
      if (isNaN(dt)) continue;
      const dias=Math.floor((dt-agora)/86400000);
      if (dias<0||dias>15) continue;
      const jaExiste=ativos.some(l=>l.produto===nome&&l.validade===val&&l.tipo!=='personalizado');
      if (jaExiste) continue;
      const notifId=await scheduleVencimentoNotifCustom(nome,val,15,'10:00');
      if (!notifId) continue;
      novos.push({ id:`auto-${Date.now()}-${Math.random()}`, produto:nome, validade:val, notifId, horario:'10:00', tipo:'auto', criadoEm:new Date().toISOString() });
    }
    const updated=[...novos,...ativos];
    await saveLembretes(updated);
    if (isMountedRef.current) setLembretes(updated);
    setAutoAgendado(true);
  }, [autoAgendado]);

  // ── Salvar lembrete personalizado (com anti-duplicata) ───────────────────
  const salvarLembrete = async () => {
    setLembreteErr('');
    if (!novoTexto.trim()) { setLembreteErr('Descreva o lembrete antes de salvar.'); return; }
    const horValido=/^\d{2}:\d{2}$/.test(novoHorario)?novoHorario:'10:00';
    // Auto-completa ano se o usuário digitou apenas DD/MM
    let dataNorm=(novoData||'').trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(dataNorm)) {
      dataNorm = `${dataNorm}/${new Date().getFullYear()}`;
    }
    setSalvando(true);
    const normalizar=s=>stripAccents(String(s||'').toLowerCase().trim().replace(/\s+/g,' '));
    const textoNorm=normalizar(novoTexto.trim());
    const existentes=await getLembretes();
    const duplicado=existentes.find(l=>normalizar(l.produto)===textoNorm&&(!dataNorm||!l.validade||l.validade===dataNorm)&&l.horario===horValido);
    if (duplicado) {
      setSalvando(false);
      setLembreteErr(`Lembrete idêntico já existe: "${duplicado.produto}" às ${duplicado.horario}`);
      return;
    }
    const similar=existentes.find(l=>normalizar(l.produto)===textoNorm);
    if (similar) {
      const continuar=await new Promise(r=>setSimilarConfirm({similar,resolve:r}));
      if (!continuar) { setSalvando(false); return; }
    }
    const granted=await requestNotifPermission();
    if (!granted) { 
      speakWithElevenLabs('Para agendar lembretes, eu preciso da sua permissão para enviar notificações. Por favor, ative-as para continuar.', () => {});
      setLembreteErr('Permita notificações nas configurações para agendar lembretes.');
      setSalvando(false);
      return; 
    }
    await initNotifChannel();
    const notifId=await scheduleCustomLembrete(novoTexto.trim(),horValido,dataNorm||null);
    if (!notifId) { setLembreteErr('Horário inválido. Escolha um horário futuro ou informe uma data.'); setSalvando(false); return; }
    const novo={ id:`custom-${Date.now()}-${Math.random()}`, produto:novoTexto.trim(), validade:dataNorm||'', notifId, horario:horValido, tipo:'personalizado', criadoEm:new Date().toISOString() };
    const updated=[novo,...existentes];
    await saveLembretes(updated);
    // Animação de salvar
    Animated.sequence([
      Animated.timing(saveAnim,{toValue:1,duration:300,useNativeDriver:false}),
      Animated.delay(800),
      Animated.timing(saveAnim,{toValue:0,duration:300,useNativeDriver:false}),
    ]).start();
    if (isMountedRef.current) {
      setLembretes(updated); setNovoTexto(''); setNovoHorario('10:00'); setNovoData('');
      // Vai para aba de lembretes para mostrar o novo item
      setTimeout(()=>{ if(isMountedRef.current) setActiveTab('lembretes'); },400);
      // Fecha o modal após a animação de sucesso
      setTimeout(()=>{ if(isMountedRef.current) onClose(); },1600);
    }
    setSalvando(false);
    speakWithElevenLabs(`Lembrete criado! Vou te avisar às ${horValido.replace(':',' horas e ')} minutos.`,()=>{});
  };

  // ── Remover lembrete ────────────────────────────────────────────────────
  const removerLembrete = async (item) => {
    await cancelNotifById(item.notifId);
    const list=await getLembretes();
    const updated=list.filter(l=>l.id!==item.id);
    await saveLembretes(updated);
    if (isMountedRef.current) setLembretes(updated);
  };

  // ── Ouvir horário por voz ────────────────────────────────────────────────
  const ouvirHorarioPorVoz = () => {
    if (!SPEECH_RECOGNITION_AVAILABLE) { setLembreteErr('Reconhecimento de voz indisponível. Use o teclado.'); return; }
    setOuvindoHor(true);
    speakWithElevenLabs('Diga o horário. Por exemplo: às dez da manhã, ou às quatorze horas.',async()=>{
      try { await ExpoSpeechRecognitionModule.start({lang:'pt-BR',interimResults:false,continuous:false}); } catch { setOuvindoHor(false); }
    });
    setTimeout(()=>{ if(isMountedRef.current) setOuvindoHor(false); },9000);
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = visible;
    if (visible) {
      setAutoAgendado(false);
      slideA.setValue(WIN.height); opacA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA,{toValue:0,tension:65,friction:13,useNativeDriver:false}),
        Animated.timing(opacA,{toValue:1,duration:220,useNativeDriver:false}),
      ]).start();
      setDisplayedText(''); setIsTyping(false); setActiveTab('resumo');
      gerarResumo(stockData);
      autoAgendarLembretes(stockData);
      getLembretes().then(list=>{ if(isMountedRef.current) setLembretes(list); });
      // Inicia animação do avatar e dot
      avatarLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(avatarPulseA,{toValue:1.08,duration:1100,useNativeDriver:false}),
        Animated.timing(avatarPulseA,{toValue:1,duration:1100,useNativeDriver:false}),
      ]));
      avatarLoopRef.current.start();
      Animated.loop(Animated.sequence([
        Animated.timing(dotPulseA,{toValue:1,duration:600,useNativeDriver:false}),
        Animated.timing(dotPulseA,{toValue:0.35,duration:600,useNativeDriver:false}),
      ])).start();
    } else {
      avatarLoopRef.current?.stop();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      try { Speech.stop(); } catch { /* noop */ }
    }
    return () => { isMountedRef.current = false; avatarLoopRef.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  // helpers visuais
  const agora2 = new Date(); agora2.setHours(0,0,0,0);
  const getDias = val => { const [d,m,y]=String(val||'').split('/'); const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`); return isNaN(dt)?999:Math.floor((dt-agora2)/86400000); };
  const getDiasCorAndEmoji = dias => {
    if (dias<0)  return { cor:T.red,    emoji:'💀', label:'VENCIDO',              bg:T.redGlow   };
    if (dias<=3) return { cor:T.red,    emoji:'🔴', label:`${dias}d — CRÍTICO`,   bg:T.redGlow   };
    if (dias<=7) return { cor:T.orange, emoji:'🟠', label:`${dias}d — URGENTE`,   bg:T.orangeGlow };
    if (dias<=15)return { cor:T.amber,  emoji:'🟡', label:`${dias}d — ATENÇÃO`,   bg:T.amberGlow  };
    return         { cor:T.green,  emoji:'🟢', label:`${dias}d — OK`,        bg:T.greenGlow  };
  };
  const lAuto = lembretes.filter(l=>l.tipo!=='personalizado');
  const lCustom= lembretes.filter(l=>l.tipo==='personalizado');
  const totalUrgentes = lembretes.filter(l=>l.tipo!=='personalizado'&&getDias(l.validade)<=7).length;

  const cardStyle = embedded ? {
    backgroundColor:T.bgCard,
    overflow:'hidden',
    flex: 1,
  } : {
    backgroundColor:T.bgCard,
    borderTopLeftRadius:42, borderTopRightRadius:42,
    borderBottomLeftRadius:0, borderBottomRightRadius:0,
    borderWidth:2, borderColor:T.purple+'80',
    borderBottomWidth:0,
    overflow:'hidden',
    transform:[{translateY:slideA}], opacity:opacA,
    maxHeight:WIN.height*0.92,
    height:WIN.height*0.92,
    shadowColor:'#000', shadowOffset:{width:0,height:-16},
    shadowOpacity:0.7, shadowRadius:36, elevation:40,
  };

  const cardContent = (
    <Animated.View style={cardStyle}>

          {/* ── Faixa decorativa topo (acento de cor IA) ── */}
          <View style={{height:5,width:'100%',backgroundColor:T.purple,opacity:0.85}} />

          {/* ── Handle decorativo ── */}
          <View style={{alignItems:'center',paddingTop:10,paddingBottom:2}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:T.purple+'50'}} />
          </View>

          {/* ── Header ── */}
          <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:22,paddingVertical:10,gap:14}}>
            {/* Avatar IA animado com anel pulsante */}
            <View style={{width:74,height:74,justifyContent:'center',alignItems:'center'}}>
              {/* Anel pulsante externo */}
              <Animated.View style={{
                position:'absolute',
                width:74,height:74,borderRadius:37,
                borderWidth:1.5,borderColor:T.purple+'35',
                transform:[{scale:avatarPulseA}],
              }} />
              {/* Avatar principal */}
              <Animated.View style={{
                width:58,height:58,borderRadius:20,
                backgroundColor:T.purple,
                justifyContent:'center',alignItems:'center',
                borderWidth:2.5,borderColor:T.purple+'80',
                shadowColor:T.purple,shadowOpacity:0.65,shadowRadius:18,elevation:14,
                transform:[{scale:avatarPulseA}],
              }}>
                <MaterialCommunityIcons name="brain" size={30} color="#FFF" />
              </Animated.View>
            </View>

            <View style={{flex:1}}>
              {/* Badge online com dot pulsante */}
              <View style={{flexDirection:'row',alignItems:'center',gap:5,marginBottom:3}}>
                <Animated.View style={{
                  width:7,height:7,borderRadius:4,
                  backgroundColor:T.green,
                  shadowColor:T.green,shadowOpacity:1,shadowRadius:5,elevation:3,
                  opacity:dotPulseA,
                }} />
                <Text style={{fontSize:9*fontScale,fontWeight:'900',color:T.green,textTransform:'uppercase',letterSpacing:1.6}}>GEI.AI · ONLINE</Text>
                {isLoading&&(
                  <View style={{marginLeft:4,backgroundColor:T.purple+'18',borderRadius:8,paddingHorizontal:6,paddingVertical:1,borderWidth:1,borderColor:T.purple+'30'}}>
                    <Text style={{fontSize:8*fontScale,fontWeight:'800',color:T.purple}}>ANALISANDO</Text>
                  </View>
                )}
              </View>
              <Text style={{fontSize:18*fontScale,fontWeight:'900',color:T.text,letterSpacing:-0.4}}>
                Painel de Inteligência
              </Text>
              {totalUrgentes>0 && (
                <View style={{flexDirection:'row',alignItems:'center',gap:4,marginTop:3,backgroundColor:T.red+'12',borderRadius:8,paddingHorizontal:6,paddingVertical:2,alignSelf:'flex-start',borderWidth:1,borderColor:T.red+'25'}}>
                  <View style={{width:5,height:5,borderRadius:3,backgroundColor:T.red}} />
                  <Text style={{fontSize:10*fontScale,fontWeight:'800',color:T.red}}>{totalUrgentes} produto{totalUrgentes>1?'s':''} crítico{totalUrgentes>1?'s':''}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose}
              style={{width:38,height:38,borderRadius:13,backgroundColor:T.bgInput,justifyContent:'center',alignItems:'center',borderWidth:1.5,borderColor:T.border}}>
              <Feather name="x" size={17} color={T.textSub} />
            </TouchableOpacity>
          </View>

          {/* ── Stats rápidos ── */}
          <View style={{flexDirection:'row',gap:8,paddingHorizontal:22,marginBottom:14}}>
            {[
              { label:'Total', value:stockData?.length||0, icon:'package', color:T.blue },
              { label:'Lembretes', value:lembretes.length, icon:'bell', color:T.amber },
              { label:'Urgentes', value:totalUrgentes, icon:'alert-triangle', color:totalUrgentes>0?T.red:T.green },
            ].map(s=>(
              <View key={s.label} style={{
                flex:1, backgroundColor:T.bgElevated, borderRadius:16, padding:10,
                borderWidth:1.5, borderColor:s.color+'25', alignItems:'center',
                shadowColor:s.color, shadowOpacity:0.08, shadowRadius:6, elevation:2,
              }}>
                <Feather name={s.icon} size={16} color={s.color} style={{marginBottom:4}} />
                <Text style={{fontSize:18*fontScale,fontWeight:'900',color:s.color,lineHeight:20*fontScale}}>{s.value}</Text>
                <Text style={{fontSize:9*fontScale,color:T.textMuted,fontWeight:'700',textTransform:'uppercase',letterSpacing:0.5,marginTop:2}}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Navegação por abas (pill pill pill) ── */}
          <View style={{marginHorizontal:22,marginBottom:16}}>
            <View style={{flexDirection:'row',backgroundColor:T.bgElevated,borderRadius:18,padding:4,position:'relative'}}>
              {/* Indicador deslizante */}
              <Animated.View style={{
                position:'absolute', top:4, bottom:4, width:'33.33%',
                left:tabLineLeft, borderRadius:14,
                backgroundColor: TABS[tabIdx]?.color||T.purple,
                shadowColor:TABS[tabIdx]?.color||T.purple,
                shadowOpacity:0.5, shadowRadius:10, elevation:6,
              }} />
              {TABS.map((tab,i)=>{
                const on=activeTab===tab.key;
                const hasBadge=tab.key==='lembretes'&&lembretes.length>0;
                return (
                  <TouchableOpacity key={tab.key} onPress={()=>setActiveTab(tab.key)}
                    style={{flex:1,paddingVertical:10,alignItems:'center',zIndex:1}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:5}}>
                      <Feather name={tab.icon} size={14} color={on?'#FFF':T.textMuted} />
                      <Text style={{fontSize:11*fontScale,fontWeight:'900',color:on?'#FFF':T.textMuted}}>{tab.label}</Text>
                      {hasBadge&&(
                        <View style={{width:16,height:16,borderRadius:8,backgroundColor:on?'rgba(255,255,255,0.3)':tab.color,justifyContent:'center',alignItems:'center'}}>
                          <Text style={{fontSize:8,fontWeight:'900',color:on?'#FFF':'#FFF'}}>{lembretes.length}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{flex:1,minHeight:0}}>
            <ScrollView style={{flex:1,paddingHorizontal:22}} contentContainerStyle={{paddingBottom:32,flexGrow:1}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ══════════════════ ABA RESUMO ══════════════════ */}
              {activeTab==='resumo'&&(<>
                {/* Caixa de texto IA com borda animada */}
                <View style={{
                  backgroundColor:T.bgElevated, borderRadius:24, padding:20,
                  borderWidth:1.5, borderColor:T.purple+'30', marginBottom:14,
                  minHeight:90,
                  shadowColor:T.purple, shadowOpacity:0.06, shadowRadius:12, elevation:3,
                }}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}}>
                    <View style={{width:28,height:28,borderRadius:9,backgroundColor:T.purple+'18',justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.purple+'30'}}>
                      <MaterialCommunityIcons name="brain" size={14} color={T.purple} />
                    </View>
                    <Text style={{fontSize:10*fontScale,fontWeight:'900',color:T.purple,textTransform:'uppercase',letterSpacing:1.2}}>Análise IA — Groq + Gemini</Text>
                    {isLoading&&<ActivityIndicator size="small" color={T.purple} style={{marginLeft:'auto'}} />}
                  </View>
                  {isLoading&&!displayedText
                    ? <View style={{alignItems:'center',paddingVertical:16,gap:8}}>
                        <MaterialCommunityIcons name="robot-excited-outline" size={36} color={T.purple+'60'} />
                        <Text style={{color:T.textSub,fontSize:12*fontScale,fontWeight:'700'}}>GEI analisando o estoque...</Text>
                      </View>
                    : <>
                        <Text style={{fontSize:13.5*fontScale,color:T.text,fontWeight:'500',lineHeight:22}}>{displayedText}</Text>
                        {isTyping&&<Text style={{color:T.purple,fontSize:20,fontWeight:'900'}}>▌</Text>}
                      </>
                  }
                </View>

                {/* Botão atualizar */}
                <TouchableOpacity onPress={()=>{if(!isLoading&&!isTyping){setDisplayedText('');gerarResumo(stockData);}}}
                  disabled={isLoading||isTyping}
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,
                    backgroundColor:T.purple+'12',borderRadius:14,paddingVertical:11,
                    borderWidth:1,borderColor:T.purple+'25',marginBottom:16,
                    opacity:(isLoading||isTyping)?0.5:1}}>
                  <Feather name="refresh-cw" size={14} color={T.purple} />
                  <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.purple}}>
                    {isLoading?'Analisando...':isTyping?'Digitando...':'Nova análise'}
                  </Text>
                </TouchableOpacity>

                {/* Preview de alertas rápidos */}
                {lAuto.length>0&&(
                  <View style={{backgroundColor:T.amberGlow,borderRadius:18,padding:14,borderWidth:1.5,borderColor:T.amber+'35',marginBottom:14}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8}}>
                      <View style={{width:32,height:32,borderRadius:10,backgroundColor:T.amber+'25',justifyContent:'center',alignItems:'center'}}>
                        <MaterialCommunityIcons name="bell-badge-outline" size={17} color={T.amber} />
                      </View>
                      <Text style={{fontSize:12*fontScale,fontWeight:'900',color:T.amber}}>
                        {lAuto.length} lembrete{lAuto.length>1?'s':''} de vencimento ativo{lAuto.length>1?'s':''}
                      </Text>
                    </View>
                    <Text style={{fontSize:11*fontScale,color:T.amber,fontWeight:'600',lineHeight:17,marginBottom:8}}>
                      🔔 Notificações agendadas automaticamente para {lAuto.length} produto{lAuto.length>1?'s':''} vencendo em ≤15 dias — ativas mesmo com app fechado.
                    </Text>
                    <TouchableOpacity onPress={()=>setActiveTab('lembretes')}
                      style={{paddingVertical:8,borderRadius:10,backgroundColor:T.amber+'20',alignItems:'center',borderWidth:1,borderColor:T.amber+'40'}}>
                      <Text style={{fontSize:11*fontScale,fontWeight:'900',color:T.amber}}>Ver lembretes →</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* CTA criar lembrete */}
                <TouchableOpacity onPress={()=>setActiveTab('novo')}
                  style={{flexDirection:'row',alignItems:'center',gap:10,
                    backgroundColor:T.green+'12',borderRadius:16,paddingVertical:12,paddingHorizontal:14,
                    borderWidth:1.5,borderColor:T.green+'25',marginBottom:20}}>
                  <View style={{width:34,height:34,borderRadius:11,backgroundColor:T.greenGlow,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.green+'30'}}>
                    <MaterialCommunityIcons name="bell-plus-outline" size={18} color={T.green} />
                  </View>
                  <View style={{flex:1}}>
                    <Text style={{fontSize:13*fontScale,fontWeight:'900',color:T.green}}>Criar lembrete personalizado</Text>
                    <Text style={{fontSize:10*fontScale,color:T.textSub,fontWeight:'600',marginTop:1}}>Defina texto, horário e data por voz ou teclado</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={T.green} />
                </TouchableOpacity>
              </>)}

              {/* ══════════════════ ABA LEMBRETES ══════════════════ */}
              {activeTab==='lembretes'&&(<>

                {/* Lembretes de vencimento automáticos */}
                {lAuto.length>0&&(
                  <View style={{marginBottom:22}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:12}}>
                      <View style={{width:26,height:26,borderRadius:8,backgroundColor:T.amberGlow,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.amber+'30'}}>
                        <Feather name="clock" size={13} color={T.amber} />
                      </View>
                      <Text style={{fontSize:11*fontScale,fontWeight:'900',color:T.amber,textTransform:'uppercase',letterSpacing:1.1}}>
                        Vencimentos ({lAuto.length})
                      </Text>
                    </View>
                    {lAuto.map(item=>{
                      const dias=getDias(item.validade);
                      const {cor,emoji,label,bg}=getDiasCorAndEmoji(dias);
                      return (
                        <View key={item.id} style={{
                          backgroundColor:T.bgElevated, borderRadius:18, padding:14,
                          borderWidth:1.5, borderColor:cor+'25', marginBottom:8,
                          flexDirection:'row', alignItems:'center', gap:12,
                          shadowColor:cor, shadowOpacity:0.06, shadowRadius:8, elevation:2,
                        }}>
                          {/* Indicador de urgência */}
                          <View style={{width:46,height:46,borderRadius:14,backgroundColor:bg,justifyContent:'center',alignItems:'center',borderWidth:1.5,borderColor:cor+'35'}}>
                            <Text style={{fontSize:20}}>{emoji}</Text>
                          </View>
                          <View style={{flex:1,gap:3}}>
                            <Text style={{fontSize:13*fontScale,fontWeight:'900',color:T.text}} numberOfLines={1}>{item.produto}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                              <View style={{paddingHorizontal:7,paddingVertical:2,borderRadius:6,backgroundColor:cor+'18',borderWidth:1,borderColor:cor+'35'}}>
                                <Text style={{fontSize:10*fontScale,fontWeight:'800',color:cor}}>{label}</Text>
                              </View>
                              <View style={{flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:6,paddingVertical:2,borderRadius:6,backgroundColor:T.bgInput,borderWidth:1,borderColor:T.border}}>
                                <Feather name="clock" size={9} color={T.textMuted} />
                                <Text style={{fontSize:9*fontScale,color:T.textMuted,fontWeight:'700'}}>{item.horario||'10:00'}</Text>
                              </View>
                              {item.validade?<Text style={{fontSize:9*fontScale,color:T.textMuted}}>📅 {item.validade}</Text>:null}
                            </View>
                          </View>
                          <TouchableOpacity
                            onPress={()=>setDeleteConfirm(item)}
                            style={{width:32,height:32,borderRadius:10,backgroundColor:T.redGlow,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.red+'25'}}>
                            <Feather name="trash-2" size={13} color={T.red} />
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    <View style={{backgroundColor:T.amberGlow,borderRadius:12,padding:10,borderWidth:1,borderColor:T.amber+'25',marginTop:2}}>
                      <Text style={{fontSize:10*fontScale,color:T.amber,fontWeight:'700',lineHeight:16}}>
                        🔔 Notificações ativas mesmo com o app em segundo plano ou fechado.
                      </Text>
                    </View>
                  </View>
                )}

                {/* Lembretes personalizados */}
                {lCustom.length>0&&(
                  <View style={{marginBottom:22}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:12}}>
                      <View style={{width:26,height:26,borderRadius:8,backgroundColor:T.blueGlow,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.blue+'30'}}>
                        <Feather name="star" size={12} color={T.blue} />
                      </View>
                      <Text style={{fontSize:11*fontScale,fontWeight:'900',color:T.blue,textTransform:'uppercase',letterSpacing:1.1}}>
                        Personalizados ({lCustom.length})
                      </Text>
                    </View>
                    {lCustom.map(item=>(
                      <View key={item.id} style={{
                        backgroundColor:T.bgElevated, borderRadius:18, padding:14,
                        borderWidth:1.5, borderColor:T.blue+'25', marginBottom:8,
                        shadowColor:T.blue, shadowOpacity:0.06, shadowRadius:8, elevation:2,
                      }}>
                        <View style={{flexDirection:'row',alignItems:'flex-start',gap:12}}>
                          <View style={{width:42,height:42,borderRadius:13,backgroundColor:T.blueGlow,justifyContent:'center',alignItems:'center',borderWidth:1.5,borderColor:T.blue+'30'}}>
                            <MaterialCommunityIcons name="bell-ring-outline" size={20} color={T.blue} />
                          </View>
                          <View style={{flex:1}}>
                            <Text style={{fontSize:13*fontScale,fontWeight:'900',color:T.text,marginBottom:5}} numberOfLines={2}>{item.produto}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                              <View style={{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:T.blue+'14',paddingHorizontal:8,paddingVertical:3,borderRadius:8,borderWidth:1,borderColor:T.blue+'25'}}>
                                <Feather name="clock" size={11} color={T.blue} />
                                <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.blue}}>às {item.horario||'10:00'}</Text>
                              </View>
                              {item.validade?<View style={{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:T.bgInput,paddingHorizontal:7,paddingVertical:3,borderRadius:8,borderWidth:1,borderColor:T.border}}><Feather name="calendar" size={10} color={T.textMuted}/><Text style={{fontSize:10*fontScale,color:T.textMuted,fontWeight:'600'}}>{item.validade}</Text></View>:null}
                            </View>
                          </View>
                          <TouchableOpacity
                            onPress={()=>setDeleteConfirm(item)}
                            style={{width:32,height:32,borderRadius:10,backgroundColor:T.redGlow,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:T.red+'25'}}>
                            <Feather name="trash-2" size={13} color={T.red} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Estado vazio */}
                {lembretes.length===0&&(
                  <View style={{alignItems:'center',paddingVertical:50,gap:12}}>
                    <View style={{width:80,height:80,borderRadius:28,backgroundColor:T.bgElevated,justifyContent:'center',alignItems:'center',borderWidth:2,borderColor:T.border,borderStyle:'dashed'}}>
                      <MaterialCommunityIcons name="bell-off-outline" size={40} color={T.textMuted} />
                    </View>
                    <Text style={{fontSize:16*fontScale,fontWeight:'900',color:T.text,marginTop:6}}>Nenhum lembrete ativo</Text>
                    <Text style={{fontSize:12*fontScale,color:T.textSub,textAlign:'center',lineHeight:18,paddingHorizontal:30}}>
                      Produtos vencendo em ≤15 dias serão notificados automaticamente. Ou crie um lembrete personalizado agora.
                    </Text>
                    <TouchableOpacity onPress={()=>setActiveTab('novo')}
                      style={{marginTop:8,paddingHorizontal:24,paddingVertical:13,borderRadius:16,backgroundColor:T.green,shadowColor:T.green,shadowOpacity:0.4,shadowRadius:12,elevation:6,flexDirection:'row',alignItems:'center',gap:8}}>
                      <MaterialCommunityIcons name="bell-plus-outline" size={18} color="#FFF" />
                      <Text style={{fontSize:14*fontScale,fontWeight:'900',color:'#FFF'}}>Criar primeiro lembrete</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>)}

              {/* ══════════════════ ABA NOVO LEMBRETE ══════════════════ */}
              {activeTab==='novo'&&(<>

                {/* Feedback de salvo */}
                <Animated.View style={{
                  overflow:'hidden',
                  maxHeight:saveAnim.interpolate({inputRange:[0,1],outputRange:[0,52]}),
                  opacity:saveAnim,marginBottom:saveAnim.interpolate({inputRange:[0,1],outputRange:[0,12]}),
                }}>
                  <View style={{backgroundColor:T.greenGlow,borderRadius:14,padding:12,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1.5,borderColor:T.green+'40'}}>
                    <Feather name="check-circle" size={18} color={T.green} />
                    <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.green}}>Lembrete criado com sucesso!</Text>
                  </View>
                </Animated.View>

                <View style={{
                  backgroundColor:T.bgElevated,borderRadius:24,padding:20,
                  borderWidth:1.5,borderColor:T.green+'25',marginBottom:16,
                  shadowColor:T.green,shadowOpacity:0.05,shadowRadius:16,elevation:3,
                }}>
                  {/* Título */}
                  <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:18}}>
                    <View style={{width:44,height:44,borderRadius:14,backgroundColor:T.greenGlow,justifyContent:'center',alignItems:'center',borderWidth:2,borderColor:T.green+'35',shadowColor:T.green,shadowOpacity:0.3,shadowRadius:8,elevation:4}}>
                      <MaterialCommunityIcons name="bell-plus-outline" size={23} color={T.green} />
                    </View>
                    <View>
                      <Text style={{fontSize:15*fontScale,fontWeight:'900',color:T.text}}>Novo Lembrete</Text>
                      <Text style={{fontSize:10*fontScale,color:T.textSub,fontWeight:'600',marginTop:1}}>Horário pode ser definido por voz 🎤</Text>
                    </View>
                  </View>

                  {/* Campo texto */}
                  <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.textSub,marginBottom:7,textTransform:'uppercase',letterSpacing:0.6}}>📝 Descrição</Text>
                  <TextInput
                    style={{
                      backgroundColor:T.bgInput, borderWidth:1.5,
                      borderColor:novoTexto?T.green:T.border, borderRadius:16,
                      padding:14, color:T.text, fontSize:14*fontScale,
                      marginBottom:4, minHeight:60, textAlignVertical:'top',
                    }}
                    placeholder="Ex: Verificar estoque de bebidas, Pedir reposição..."
                    placeholderTextColor={T.textMuted}
                    value={novoTexto}
                    onChangeText={setNovoTexto}
                    multiline maxLength={200}
                  />
                  <Text style={{fontSize:9*fontScale,color:T.textMuted,textAlign:'right',marginBottom:16}}>{novoTexto.length}/200</Text>

                  {/* Campo horário + botão voz */}
                  <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.textSub,marginBottom:7,textTransform:'uppercase',letterSpacing:0.6}}>🕐 Horário da notificação</Text>
                  <View style={{flexDirection:'row',gap:10,marginBottom:8,alignItems:'center'}}>
                    <View style={{flex:1,position:'relative'}}>
                      <TextInput
                        style={{
                          backgroundColor:T.bgInput, borderWidth:1.5,
                          borderColor:novoHorario?T.blue:T.border, borderRadius:16,
                          padding:14, paddingRight:14, color:T.text,
                          fontSize:20*fontScale, fontWeight:'900', textAlign:'center',
                          letterSpacing:2,
                        }}
                        placeholder="10:00"
                        placeholderTextColor={T.textMuted}
                        value={novoHorario}
                        onChangeText={v=>{
                          let n=v.replace(/[^0-9:]/g,'');
                          if(n.length===4&&!n.includes(':')) n=`${n.slice(0,2)}:${n.slice(2)}`;
                          setNovoHorario(n.slice(0,5));
                        }}
                        keyboardType="numbers-and-punctuation" maxLength={5}
                      />
                      {/* Badge de turno ao lado do campo de horário */}
                      {/^\d{2}:\d{2}$/.test(novoHorario) && (() => {
                        const h = parseInt(novoHorario.split(':')[0], 10);
                        const turno = h >= 5 && h < 12 ? { label:'Manhã', emoji:'🌅', color:T.amber }
                                    : h >= 12 && h < 18 ? { label:'Tarde', emoji:'☀️', color:T.orange }
                                    : { label:'Noite', emoji:'🌙', color:T.purple };
                        return (
                          <View style={{
                            position:'absolute', top:10, right:10,
                            flexDirection:'row', alignItems:'center', gap:4,
                            backgroundColor:turno.color+'18', borderRadius:10,
                            paddingHorizontal:8, paddingVertical:3,
                            borderWidth:1, borderColor:turno.color+'35',
                          }}>
                            <Text style={{fontSize:12}}>{turno.emoji}</Text>
                            <Text style={{fontSize:10*fontScale, fontWeight:'800', color:turno.color}}>{turno.label}</Text>
                          </View>
                        );
                      })()}
                    </View>
                    {/* Botão mic com feedback visual */}
                    <TouchableOpacity onPress={ouvirHorarioPorVoz}
                      style={{
                        width:58,height:58,borderRadius:18,
                        justifyContent:'center',alignItems:'center',
                        backgroundColor:ouvinHorario?T.red:T.blue,
                        shadowColor:ouvinHorario?T.red:T.blue,
                        shadowOpacity:0.5,shadowRadius:12,elevation:6,
                        borderWidth:2,borderColor:ouvinHorario?T.red:T.blue+'80',
                      }}>
                      {ouvinHorario
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <MaterialCommunityIcons name="microphone" size={26} color="#FFF" />
                      }
                    </TouchableOpacity>
                  </View>
                  {ouvinHorario&&(
                    <View style={{backgroundColor:T.redGlow,borderRadius:12,padding:10,marginBottom:8,borderWidth:1,borderColor:T.red+'30',flexDirection:'row',alignItems:'center',gap:8}}>
                      <View style={{width:8,height:8,borderRadius:4,backgroundColor:T.red}} />
                      <Text style={{fontSize:11*fontScale,color:T.red,fontWeight:'800'}}>Ouvindo... diga o horário agora!</Text>
                    </View>
                  )}
                  <Text style={{fontSize:10*fontScale,color:T.textMuted,marginBottom:18,lineHeight:15}}>
                    💡 Diga: "às dez da manhã", "às quatorze horas e trinta", "8h30"...
                  </Text>

                  {/* Campo data opcional */}
                  <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.textSub,marginBottom:7,textTransform:'uppercase',letterSpacing:0.6}}>📅 Data (opcional)</Text>
                  <TextInput
                    style={{
                      backgroundColor:T.bgInput, borderWidth:1.5,
                      borderColor:novoData?T.teal:T.border, borderRadius:16,
                      padding:14, color:T.text, fontSize:14*fontScale, marginBottom:5,
                    }}
                    placeholder="dd/mm/aaaa — deixe vazio para hoje/amanhã"
                    placeholderTextColor={T.textMuted}
                    value={novoData}
                    onChangeText={v=>{
                      let n=v.replace(/[^0-9/]/g,'');
                      if(n.length===2&&!n.includes('/')&&novoData.length<2) n+='/';
                      else if(n.length===5&&n.split('/').length<3) n+='/';
                      setNovoData(n.slice(0,10));
                    }}
                    keyboardType="numbers-and-punctuation" maxLength={10}
                  />
                  <Text style={{fontSize:9*fontScale,color:T.textMuted,marginBottom:20,lineHeight:14}}>
                    Sem data = notificação hoje (se horário futuro) ou amanhã.
                  </Text>

                  {/* Botão salvar */}
                  <TouchableOpacity onPress={salvarLembrete} disabled={salvando||!novoTexto.trim()}
                    style={{
                      height:58, borderRadius:18,
                      backgroundColor:(!novoTexto.trim())?T.bgInput:T.green,
                      justifyContent:'center', alignItems:'center',
                      flexDirection:'row', gap:10,
                      shadowColor:T.green, shadowOpacity:(!novoTexto.trim())?0:0.5,
                      shadowRadius:16, elevation:(!novoTexto.trim())?0:8,
                      borderWidth:1.5, borderColor:(!novoTexto.trim())?T.border:T.green,
                    }}>
                    {salvando
                      ? <ActivityIndicator color="#FFF" size="small" />
                      : <MaterialCommunityIcons name="bell-check-outline" size={22} color={(!novoTexto.trim())?T.textMuted:'#FFF'} />
                    }
                    <Text style={{fontSize:16*fontScale,fontWeight:'900',color:(!novoTexto.trim())?T.textMuted:'#FFF'}}>
                      {salvando?'Criando...':'Criar Lembrete'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Card informativo */}
                <View style={{backgroundColor:T.blueGlow,borderRadius:18,padding:16,borderWidth:1.5,borderColor:T.blue+'25',marginBottom:24}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8}}>
                    <MaterialCommunityIcons name="shield-check-outline" size={18} color={T.blue} />
                    <Text style={{fontSize:12*fontScale,fontWeight:'900',color:T.blue}}>Notificações em segundo plano</Text>
                  </View>
                  <Text style={{fontSize:11*fontScale,color:T.textSub,fontWeight:'600',lineHeight:17}}>
                    O GEI.AI usa o sistema nativo de notificações do Android/iOS. Os lembretes disparam mesmo com o app fechado, em modo silencioso ou em segundo plano — sem nenhuma ação sua.
                  </Text>
                </View>
              </>)}

            </ScrollView>
          </KeyboardAvoidingView>

          {/* ── Banner de erro inline ── */}
          {lembreteErr ? (
            <View style={{margin:16,marginTop:0,flexDirection:'row',alignItems:'center',gap:10,padding:14,backgroundColor:T.redGlow,borderRadius:16,borderWidth:1.5,borderColor:T.red+'40'}}>
              <Feather name="alert-circle" size={17} color={T.red} />
              <Text style={{flex:1,fontSize:13,fontWeight:'800',color:T.red,lineHeight:19}}>{lembreteErr}</Text>
              <TouchableOpacity onPress={()=>setLembreteErr('')} style={{padding:4}}><Feather name="x" size={15} color={T.red} /></TouchableOpacity>
            </View>
          ) : null}

          {/* ── Mini-modal confirmação deletar lembrete ── */}
          {deleteConfirm && (
            <View style={{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end',borderRadius:42,overflow:'hidden'}}>
              <View style={{backgroundColor:T.bgCard,borderTopLeftRadius:28,borderTopRightRadius:28,padding:24,borderWidth:1.5,borderColor:T.red+'40',borderBottomWidth:0}}>
                <View style={{alignItems:'center',marginBottom:18}}>
                  <View style={{width:52,height:52,borderRadius:16,backgroundColor:T.redGlow,justifyContent:'center',alignItems:'center',marginBottom:12,borderWidth:1.5,borderColor:T.red+'40'}}><Feather name="trash-2" size={24} color={T.red} /></View>
                  <Text style={{fontSize:17,fontWeight:'900',color:T.text,textAlign:'center',marginBottom:6}}>Remover lembrete?</Text>
                  <Text style={{fontSize:13,color:T.textSub,textAlign:'center',fontWeight:'600',lineHeight:20}}>"{deleteConfirm.produto}"</Text>
                </View>
                <View style={{flexDirection:'row',gap:10}}>
                  <TouchableOpacity onPress={()=>setDeleteConfirm(null)} style={{flex:1,paddingVertical:15,borderRadius:16,backgroundColor:T.bgInput,alignItems:'center',borderWidth:1,borderColor:T.border}}><Text style={{color:T.textSub,fontWeight:'900',fontSize:15}}>Cancelar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={()=>{removerLembrete(deleteConfirm);setDeleteConfirm(null);}} style={{flex:1,paddingVertical:15,borderRadius:16,backgroundColor:T.red,alignItems:'center'}}><Text style={{color:'#fff',fontWeight:'900',fontSize:15}}>Remover</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ── Mini-modal similar encontrado ── */}
          {similarConfirm && (
            <View style={{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end',borderRadius:42,overflow:'hidden'}}>
              <View style={{backgroundColor:T.bgCard,borderTopLeftRadius:28,borderTopRightRadius:28,padding:24,borderWidth:1.5,borderColor:T.amber+'40',borderBottomWidth:0}}>
                <View style={{alignItems:'center',marginBottom:18}}>
                  <View style={{width:52,height:52,borderRadius:16,backgroundColor:T.amberGlow,justifyContent:'center',alignItems:'center',marginBottom:12,borderWidth:1.5,borderColor:T.amber+'40'}}><Feather name="bell" size={24} color={T.amber} /></View>
                  <Text style={{fontSize:17,fontWeight:'900',color:T.text,textAlign:'center',marginBottom:6}}>Lembrete similar encontrado</Text>
                  <Text style={{fontSize:13,color:T.textSub,textAlign:'center',fontWeight:'600',lineHeight:20}}>"{similarConfirm.similar.produto}" às {similarConfirm.similar.horario}</Text><Text style={{fontSize:13,color:T.textSub,textAlign:'center',fontWeight:'600'}}>Criar outro mesmo assim?</Text>
                </View>
                <View style={{flexDirection:'row',gap:10}}>
                  <TouchableOpacity onPress={()=>{const r=similarConfirm.resolve;setSimilarConfirm(null);r(false);}} style={{flex:1,paddingVertical:15,borderRadius:16,backgroundColor:T.bgInput,alignItems:'center',borderWidth:1,borderColor:T.border}}><Text style={{color:T.textSub,fontWeight:'900',fontSize:15}}>Cancelar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={()=>{const r=similarConfirm.resolve;setSimilarConfirm(null);r(true);}} style={{flex:1,paddingVertical:15,borderRadius:16,backgroundColor:T.amber,alignItems:'center'}}><Text style={{color:'#fff',fontWeight:'900',fontSize:15}}>Criar mesmo assim</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )}

    </Animated.View>
  );

  if (embedded) return cardContent;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.85)',justifyContent:'flex-end'}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {cardContent}
      </View>
    </Modal>
  );
};
// ── Wake words e comandos ────────────────────────────────────────────────────
const WAKE_WORDS_LIST = [
  'abrir painel','abre painel','abrir o painel','entrar painel',
  'cadastrar produto','novo produto',
  'registrar produto',
  'qual a boa','qual e a boa','qual e a novidade','me conta as novidades',
  'criar lembrete','novo lembrete','adicionar lembrete','lembrete novo',
  'calculadora','calcular pinha','calcula pinha','calculadora de pinha','abre calculadora','abrir calculadora',
];
const stripAccents = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const detectWakeWord = (text) => {
  if (!text) return false;
  const n = stripAccents(text);
  return WAKE_WORDS_LIST.some(w => n.includes(stripAccents(w)));
};
// ── Wake words do JARVIS (Painel Inteligente + microfone ativo por voz) ──────
// Qualquer uma dessas frases abre o Painel Inteligente E já ativa o microfone
// do JARVIS (jarvisVoiceMode), tudo por comando de voz, sem clique.
const JARVIS_WAKE_WORDS = [
  'abrir javis','abrir jarvis','abre javis','abre jarvis','abrir o javis','abrir o jarvis',
  'ativar javis','ativar jarvis','chamar javis','chamar jarvis',
  'ei javis','ei jarvis','oi javis','oi jarvis','hey javis','hey jarvis','ola javis','ola jarvis',
  'gei javis','gei jarvis','javis','jarvis',
  'abrir assistente','abre assistente','abrir o assistente','ativar assistente','chamar assistente',
  'oi gei','ola gei','ei gei','hey gei','gei assistente',
  // ── "Ok GEI" — palavra de ativação no estilo "Ok Google" / "Hey Siri" ──────
  // Inclui variações fonéticas comuns de como o reconhecimento de voz em
  // PT-BR pode transcrever "ok gei" (okay/oquei/ok + gei/jay/jei).
  'ok gei','oka gei','okay gei','oquei gei','oque gei','okei gei','ok je','ok jay','ok jei',
  'assistente inteligente','abrir o painel inteligente','abrir painel inteligente','abre painel inteligente',
  'painel inteligente','inteligente',
  'robo','abrir robo','abre robo','ativar robo','chamar robo',
];
const detectJarvisWakeWord = (text) => {
  if (!text) return false;
  const n = stripAccents(text);
  return JARVIS_WAKE_WORDS.some(w => n.includes(stripAccents(w)));
};
const isCancelCmd = (text) => {
  const n = stripAccents(text||'');
  return ['cancelar','sair','fechar','parar','para ','encerrar','desistir','para tudo'].some(w=>n.includes(w));
};
const isConfirmCmd = (text) => {
  const n = stripAccents(text||'');
  return ['sim','isso','correto','confirmar','confirma','pode ','ok ','isso mesmo','certo','positivo','bom','quero','salvar'].some(w=>n.includes(w)||n===w.trim());
};
const isCorrectCmd = (text) => {
  const n = stripAccents(text||'');
  return ['corrigir','mudar','errado','errada','incorreto','nao','voltar','repetir','de novo','trocar','refazer'].some(w=>n.includes(w));
};
const isClosePanelCmd = (text) => {
  const n = stripAccents(text||'');
  return ['fechar painel','fechar o painel','fecha painel','encerrar painel','sair do painel','fecha o painel'].some(w=>n.includes(w));
};
const isOpenPanelCmd = (text) => {
  const n = stripAccents(text||'');
  return ['abrir painel','abrir o painel','abre painel','abre o painel','ativar painel','abra painel','abra o painel'].some(w=>n.includes(w));
};

// ── Estados do motor ─────────────────────────────────────────────────────────
const VS = {
  IDLE:'idle', PROD:'product', QTY:'qty',
  DATE:'date', GIRO:'giro', CONFIRM:'confirm', SAVING:'saving',
  FIFO_MATCH:'fifo_match', EDIT_WHAT:'edit_what', EDIT_VALUE:'edit_value',
  CORRECT_FIELD:'correct_field', CORRECT_VALUE:'correct_value',
  // ── Fluxo lembrete step-by-step ──────────────────────────────────────────
  LEM_TEXTO:'lem_texto',   // aguardando o texto do lembrete
  LEM_DATA:'lem_data',     // aguardando a data
  LEM_HORA:'lem_hora',     // aguardando o horário
  LEM_CONFIRM:'lem_confirm', // confirmação final
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: VoiceAssistant (Smart Engine)
// ─────────────────────────────────────────────────────────────────────────────
const VoiceAssistant = ({
  visible, onClose, onComplete, T, fontScale,
  setProdName, setGiro, setValidade, setQtd, setWStep,
  fromWakeWord, stockData, scannedEAN, doUpdateExisting,
  micSoundEnabled, micVibrationEnabled, micSoundVolume,
}) => {
  const [voiceEngine, setVoiceEngine] = useState('native');
  const voiceEngineRef = useRef('native');
  useEffect(() => { voiceEngineRef.current = voiceEngine; }, [voiceEngine]);

  // Estado conversacional
  const [vsState, setVsState] = useState(VS.IDLE);
  const vsStateRef = useRef(VS.IDLE);
  const setVsStateBoth = useCallback((s) => { vsStateRef.current = s; setVsState(s); }, []);

  // Dados coletados
  const dataRef = useRef({ nome:'', qty:'', date:'', giro:'Médio giro' });
  const [collected, setCollected] = useState({ nome:'', qty:'', date:'', giro:'' });

  // ── Dados do lembrete step-by-step ───────────────────────────────────────
  const lemRef = useRef({ texto:'', data:'', hora:'10:00' });
  const [lemCollected, setLemCollected] = useState({ texto:'', data:'', hora:'' });

  // ✅ Correção inteligente: guarda qual etapa retomar e qual campo está sendo corrigido
  const lastCompletedStepRef = useRef(VS.IDLE); // última etapa concluída antes do "corrigir"
  const correctingFieldRef   = useRef(null);    // 'nome' | 'qty' | 'date' | 'giro' | null

  // UI
  const [listening, setListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastSpoken, setLastSpoken] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const retryRef = useRef(0);
  const isTtsActiveRef    = useRef(false); // bloqueia mic enquanto TTS fala
  const editingFieldRef   = useRef(null);  // campo sendo editado (FIFO edit)
  const fifoExistingRef   = useRef(null);  // item ja existente no stock

  // ── Animação de sucesso ao salvar ───────────────────────────────────────
  const [showSaveAnim, setShowSaveAnim] = useState(false);
  const sOpac    = useRef(new Animated.Value(0)).current;
  const sCircle  = useRef(new Animated.Value(0)).current;
  const sCheck   = useRef(new Animated.Value(0)).current;
  const sTextO   = useRef(new Animated.Value(0)).current;
  const sTextY   = useRef(new Animated.Value(28)).current;
  const sRing1   = useRef(new Animated.Value(0.9)).current;
  const sRingO1  = useRef(new Animated.Value(0)).current;
  const sRing2   = useRef(new Animated.Value(0.9)).current;
  const sRingO2  = useRef(new Animated.Value(0)).current;
  const sPartO   = useRef(new Animated.Value(0)).current;
  const sPartS   = useRef(new Animated.Value(0.4)).current;
  const sSubTextO = useRef(new Animated.Value(0)).current;

  // Animações
  const slideA = useRef(new Animated.Value(WIN.height)).current;
  const opacA  = useRef(new Animated.Value(0)).current;
  const pulseA = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);
  const recordingRef = useRef(null);
  const listeningRef = useRef(false);
  const autoRestartRef = useRef(null);
  const isStartingMicRef = useRef(false); // ✅ guard: evita start() concorrente
  const lastRestartRef   = useRef(0);     // ✅ cooldown: timestamp do último restart
  const soundPlayedRef   = useRef(false); // ✅ guard: toca audior.mp3 só 1x por sessão
  const visibleRef       = useRef(false); // ✅ sincroniza visibilidade para callbacks async
  const listenTimeoutsRef = useRef([]);   // ✅ rastreia todos os setTimeout de listenAfterSpeak
  const closingRef        = useRef(false); // ✅ trava definitiva: true após primeira chamada de close

  // ── TTS ──────────────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!visibleRef.current || closingRef.current) return; // ✅ não fala se modal fechou
    isTtsActiveRef.current = true;
    const wrapped = (...args) => {
      isTtsActiveRef.current = false;
      if (!visibleRef.current || closingRef.current) return; // ✅ não executa callback se fechou durante TTS
      if (onDone) onDone(...args);
    };
    try {
      setLastSpoken(text);
      speakWithElevenLabs(text, wrapped);
    } catch { isTtsActiveRef.current = false; if (onDone && visibleRef.current && !closingRef.current) setTimeout(onDone, 100); }
  }, []);

  // ── Pulso animado ─────────────────────────────────────────────────────────
  const startPulse = useCallback(() => {
    if (pulseLoop.current) return;
    pulseLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(pulseA, { toValue:1.2, duration:650, useNativeDriver:false }),
      Animated.timing(pulseA, { toValue:1,   duration:650, useNativeDriver:false }),
    ]));
    pulseLoop.current.start();
  }, [pulseA]);
  const stopPulse = useCallback(() => {
    if (pulseLoop.current) { pulseLoop.current.stop(); pulseLoop.current = null; }
    Animated.timing(pulseA, { toValue:1, duration:200, useNativeDriver:false }).start();
  }, [pulseA]);

  const triggerSaveAnimation = useCallback(() => {
    sOpac.setValue(0); sCircle.setValue(0); sCheck.setValue(0);
    sTextO.setValue(0); sTextY.setValue(28); sSubTextO.setValue(0);
    sRing1.setValue(0.9); sRingO1.setValue(0);
    sRing2.setValue(0.9); sRingO2.setValue(0);
    sPartO.setValue(0); sPartS.setValue(0.3);
    setShowSaveAnim(true);
    Animated.sequence([
      Animated.timing(sOpac, { toValue:1, duration:220, useNativeDriver:false }),
      Animated.parallel([
        Animated.spring(sCircle, { toValue:1, tension:90, friction:6, useNativeDriver:false }),
        Animated.sequence([
          Animated.timing(sRingO1, { toValue:1, duration:80, useNativeDriver:false }),
          Animated.parallel([
            Animated.timing(sRing1, { toValue:2.8, duration:700, useNativeDriver:false }),
            Animated.timing(sRingO1, { toValue:0, duration:700, useNativeDriver:false }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(180),
          Animated.timing(sRingO2, { toValue:0.7, duration:80, useNativeDriver:false }),
          Animated.parallel([
            Animated.timing(sRing2, { toValue:3.4, duration:850, useNativeDriver:false }),
            Animated.timing(sRingO2, { toValue:0, duration:850, useNativeDriver:false }),
          ]),
        ]),
      ]),
      Animated.spring(sCheck, { toValue:1, tension:120, friction:5, useNativeDriver:false }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(sPartO, { toValue:1, duration:180, useNativeDriver:false }),
          Animated.delay(500),
          Animated.timing(sPartO, { toValue:0, duration:400, useNativeDriver:false }),
        ]),
        Animated.spring(sPartS, { toValue:1, tension:60, friction:9, useNativeDriver:false }),
        Animated.parallel([
          Animated.timing(sTextO, { toValue:1, duration:380, useNativeDriver:false }),
          Animated.timing(sTextY, { toValue:0, duration:380, useNativeDriver:false }),
        ]),
        Animated.sequence([
          Animated.delay(180),
          Animated.timing(sSubTextO, { toValue:1, duration:350, useNativeDriver:false }),
        ]),
      ]),
    ]).start();
    setTimeout(() => {
      Animated.timing(sOpac, { toValue:0, duration:350, useNativeDriver:false }).start(() => setShowSaveAnim(false));
    }, 2800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Motor nativo ───────────────────────────────────────────────────────────
  const onSpeechStart   = useCallback(() => {
    isStartingMicRef.current = false; // start confirmado pelo SO
    setListening(true); listeningRef.current = true; startPulse();
    // ✅ Toca audior.mp3 só 1x por sessão de escuta (guard evita repetição)
    if (!soundPlayedRef.current) {
      soundPlayedRef.current = true;
      if (micSoundEnabled) {
        playAudioR(micSoundVolume, micVibrationEnabled);
      } else if (micVibrationEnabled) {
        try { Vibration.vibrate([40, 30, 60]); } catch { /* noop */ }
      }
    }
  }, [startPulse, micSoundEnabled, micSoundVolume, micVibrationEnabled]);

  // ── Agenda restart seguro com cooldown e single-timer ─────────────────────
  const _scheduleRestart = useCallback((delayMs = 400) => {
    if (autoRestartRef.current) { clearTimeout(autoRestartRef.current); autoRestartRef.current = null; }
    // Cooldown mínimo 300ms entre restarts
    const sinceLastRestart = Date.now() - lastRestartRef.current;
    const effectiveDelay   = Math.max(delayMs, 300 - sinceLastRestart);
    autoRestartRef.current = setTimeout(() => {
      autoRestartRef.current = null;
      if (!visibleRef.current || closingRef.current) return; // ✅ modal fechou
      if (isTtsActiveRef.current) return;           // ✅ TTS falando, não inicia mic
      if (isStartingMicRef.current) return;         // ✅ já em processo de start
      if (listeningRef.current) return;             // ✅ já ouvindo
      const cur = vsStateRef.current;
      if (cur === VS.IDLE || cur === VS.SAVING) return; // ✅ não reinicia em idle/saving
      startNativeListening();
    }, effectiveDelay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSpeechEnd     = useCallback(() => {
    isStartingMicRef.current = false;
    soundPlayedRef.current   = false; // ✅ reseta para próxima sessão
    setListening(false); listeningRef.current = false; stopPulse();
    const cur = vsStateRef.current;
    if (cur !== VS.IDLE && cur !== VS.SAVING) {
      _scheduleRestart(350);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPulse, _scheduleRestart]);

  const onSpeechResult  = useCallback((event) => {
    const raw = event?.results?.[0]?.transcript || '';
    const text = normalizeVoiceInput(raw);
    setTranscript(text);
    if (event.isFinal) handleVoiceInput(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSpeechError = useCallback((event) => {
    isStartingMicRef.current = false;
    soundPlayedRef.current   = false; // ✅ reseta para próxima sessão
    setListening(false); listeningRef.current = false; stopPulse();
    const code = event?.error || '';
    if (['no-match', 'network', 'aborted'].includes(code)) {
      _scheduleRestart(400);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPulse, _scheduleRestart]);

  const startNativeListening = async () => {
    if (!visibleRef.current || closingRef.current) return; // ✅ modal fechou, não inicia
    if (isStartingMicRef.current) return;         // ✅ já em processo de start (evita concorrência)
    if (listeningRef.current) return;             // ✅ já ouvindo
    if (isTtsActiveRef.current) return;           // ✅ aguarda TTS terminar
    // Cooldown mínimo: 500ms entre starts consecutivos
    const now = Date.now();
    if (now - lastRestartRef.current < 200) return;
    isStartingMicRef.current = true;
    lastRestartRef.current   = now;
    soundPlayedRef.current   = false; // ✅ reseta guard de som para nova sessão
    try {
      const ok = await requestMicPermission();
      if (!ok) { isStartingMicRef.current = false; setErrorMsg('Permissão de microfone negada'); return; }
      if (!visibleRef.current || closingRef.current || listeningRef.current) { isStartingMicRef.current = false; return; } // ✅ re-check após await
      setTranscript(''); setErrorMsg('');
      // ✅ Som/vibração tocados no onSpeechStart (após mic confirmar inicio)
      // Tocar ANTES do start() causava conflito de hardware de áudio no Android
      await ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: true, continuous: false });
      // onSpeechStart vai setar isStartingMicRef.current = false quando o SO confirmar
    } catch {
      isStartingMicRef.current = false; // ✅ libera guard em caso de falha
    }
  };
  const stopNativeListening = async () => {
    isStartingMicRef.current = false;
    if (autoRestartRef.current) { clearTimeout(autoRestartRef.current); autoRestartRef.current = null; }
    try { await ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
    setListening(false); listeningRef.current = false; stopPulse();
  };

  // ── Motor Deepgram ─────────────────────────────────────────────────────────
  const startDeepgramRecording = async () => {
    if (isRecording || recordingRef.current) return;
    try {
      // Audio.requestPermissionsAsync não funciona na web — pular
      if (Platform.OS !== 'web') {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) { setErrorMsg('Permissão negada'); return; }
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS:true, playsInSilentModeIOS:true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true); setListening(true); setTranscript(''); setErrorMsg(''); startPulse();
      // ✅ Aguarda 150ms para o hardware de gravação liberar antes de tocar áudio
      setTimeout(() => {
        if (micSoundEnabled) {
          playAudioR(micSoundVolume, micVibrationEnabled);
        } else if (micVibrationEnabled) {
          try {
            const Haptics = require('expo-haptics');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch { try { Vibration.vibrate(100); } catch { /* noop */ } }
        }
      }, 150);
    } catch { setErrorMsg('Erro ao iniciar gravação'); }
  };
  const stopDeepgramRecording = async () => {
    if (!recordingRef.current) return;
    try {
      stopPulse(); setIsRecording(false); setListening(false);
      setIsProcessing(true); setTranscript('Processando...');
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS:false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      const r = await fetch(
        'https://api.deepgram.com/v1/listen?language=pt-BR&model=nova-2&smart_format=true&punctuate=true',
        { method:'POST', headers:{ 'Authorization':`Token ${DEEPGRAM_API_KEY}`, 'Content-Type':'audio/m4a' }, body:{ uri, type:'audio/m4a', name:'audio.m4a' } }
      );
      const res = await r.json();
      const text = res?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      setIsProcessing(false);
      if (text.trim()) {
        const normalized = normalizeVoiceInput(text.trim());
        setTranscript(normalized);
        handleVoiceInput(normalized);
      } else {
        setTranscript(''); retryRef.current++;
        if (retryRef.current <= 2) {
          speak('Não entendi. Pode repetir?', () => setTimeout(startDeepgramRecording, 900));
        } else {
          retryRef.current = 0;
          setErrorMsg('Áudio não reconhecido. Tente novamente.');
        }
      }
    } catch {
      setIsProcessing(false); setTranscript('');
      setErrorMsg('Erro de rede. Verifique a conexão.');
      recordingRef.current = null;
    }
  };

  const listenAfterSpeak = useCallback((delay=550) => {
    if (!visibleRef.current || closingRef.current) return; // ✅ modal fechou antes de chamar
    const t1 = setTimeout(() => {
      listenTimeoutsRef.current = listenTimeoutsRef.current.filter(t => t !== t1);
      if (visibleRef.current && !closingRef.current) playListenBeep();
    }, Math.max(0, delay - 80));
    const t2 = setTimeout(() => {
      listenTimeoutsRef.current = listenTimeoutsRef.current.filter(t => t !== t2);
      if (!visibleRef.current || closingRef.current) return; // ✅ garante que modal ainda está aberto
      if (voiceEngineRef.current === 'native') startNativeListening();
    }, delay);
    listenTimeoutsRef.current.push(t1, t2); // ✅ registra para cancelamento
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const micPress = () => {
    if (isProcessing) return;
    if (voiceEngineRef.current === 'deepgram') {
      if (isRecording) stopDeepgramRecording(); else startDeepgramRecording();
    } else {
      if (listening) stopNativeListening(); else startNativeListening();
    }
  };

  // ── Máquina de estados conversacional ────────────────────────────────────
  const handleVoiceInput = (text) => {
    if (!text || !text.trim()) return;
    const cur = vsStateRef.current;
    setErrorMsg('');
    retryRef.current = 0;

    // Cancelamento global
    if (isCancelCmd(text)) {
      speak('Tudo bem, cancelado!');
      setTimeout(() => { setVsStateBoth(VS.IDLE); onClose(); }, 1200);
      return;
    }

    // Comando para fechar painel
    if (isClosePanelCmd(text)) {
      speak('Fechando o painel agora!');
      setTimeout(() => { setVsStateBoth(VS.IDLE); onClose(); }, 1000);
      return;
    }

    // Comando para abrir painel (já está aberto, confirmar)
    if (isOpenPanelCmd(text)) {
      speak('O painel já está aberto! Como posso ajudar?', () => listenAfterSpeak());
      return;
    }

    // Corrigir durante confirmação
    
    // Corrigir durante confirmação - Agora pergunta o que corrigir
    if (cur === VS.CONFIRM && isCorrectCmd(text)) {
      setVsStateBoth(VS.EDIT_WHAT);
      speak('O que você deseja corrigir? Nome, quantidade, vencimento ou giro?', () => listenAfterSpeak());
      return;
    }


    switch (cur) {
      case VS.IDLE: {
        // ── Lembrete step-by-step: "me lembre de passar data amanhã" ─────────
        if (detectLembreteCmd(text)) {
          const textoExtraido = extractLembreteTexto(text);
          lemRef.current = { texto:'', data:'', hora:'10:00' };
          setLemCollected({ texto:'', data:'', hora:'' });
          if (textoExtraido && textoExtraido.length > 3 && !detectLembreteCmd(textoExtraido)) {
            // Já tem o texto na frase → pula direto para data
            lemRef.current.texto = textoExtraido;
            setLemCollected(p => ({ ...p, texto: textoExtraido }));
            setVsStateBoth(VS.LEM_DATA);
            speak(`"${textoExtraido}". Qual a data?`, () => listenAfterSpeak(500));
          } else {
            setVsStateBoth(VS.LEM_TEXTO);
            speak('Claro! O que devo te lembrar? Descreva o lembrete.', () => listenAfterSpeak());
          }
          return;
        }
        if (detectWakeWord(text)) {
          setVsStateBoth(VS.PROD);
          retryRef.current = 0;
          speak('Qual o nome do produto?', () => listenAfterSpeak());
        } else {
          speak('Diga "cadastrar produto" ou "me lembre de algo" para começar.', () => listenAfterSpeak(200));
        }
        break;
      }

      // ── Etapa 1: texto do lembrete ────────────────────────────────────────
      case VS.LEM_TEXTO: {
        if (!text || text.trim().length < 2) {
          speak('Não entendi. O que devo te lembrar?', () => listenAfterSpeak());
          return;
        }
        lemRef.current.texto = text.trim();
        setLemCollected(p => ({ ...p, texto: text.trim() }));
        setVsStateBoth(VS.LEM_DATA);
        speak(`"${text.trim()}". Qual a data?`, () => listenAfterSpeak(500));
        break;
      }

      // ── Etapa 2: data do lembrete ─────────────────────────────────────────
      case VS.LEM_DATA: {
        const n = stripAccents(text.toLowerCase());
        let dataStr = null;
        // Atalhos relativos
        const hoje = new Date();
        // "data de cadastro", "data de registro", "data de entrada do produto"
        // → usa hoje como data, é a data de quando o produto foi registrado
        if (/\b(data\s+(de\s+)?(cadastro|cadastramento|registro|entrada|envio|compra|aquisicao|recebimento))\b/.test(n)
          || /\bcadastro\s+do\s+produto\b/.test(n)) {
          dataStr = hoje.toLocaleDateString('pt-BR');
        } else if (/\bamanha\b/.test(n)) {
          const d = new Date(hoje); d.setDate(d.getDate() + 1);
          dataStr = d.toLocaleDateString('pt-BR');
        } else if (/\bhoje\b|\bagora\b/.test(n)) {
          dataStr = hoje.toLocaleDateString('pt-BR');
        } else if (/\bsemana que vem\b|\bproxima semana\b/.test(n)) {
          const d = new Date(hoje); d.setDate(d.getDate() + 7);
          dataStr = d.toLocaleDateString('pt-BR');
        } else if (/\bdepois\s+de\s+amanha\b/.test(n)) {
          const d = new Date(hoje); d.setDate(d.getDate() + 2);
          dataStr = d.toLocaleDateString('pt-BR');
        } else if (/\bem\s+(\d+)\s+dias?\b/.test(n)) {
          const match = n.match(/em\s+(\d+)\s+dias?/);
          if (match) {
            const d = new Date(hoje); d.setDate(d.getDate() + parseInt(match[1]));
            dataStr = d.toLocaleDateString('pt-BR');
          }
        } else {
          // Dias da semana
          const diasSemana = { 'segunda feira':1, segunda:1, terca:2, quarta:3, quinta:4, sexta:5, sabado:6, domingo:0 };
          for (const [nome, diaNum] of Object.entries(diasSemana)) {
            if (n.includes(nome)) {
              const d = new Date(hoje);
              const diff = (diaNum - d.getDay() + 7) % 7 || 7;
              d.setDate(d.getDate() + diff);
              dataStr = d.toLocaleDateString('pt-BR');
              break;
            }
          }
          // Data por extenso
          if (!dataStr) dataStr = parsePortugueseDate(text);
        }
        if (!dataStr) {
          speak('Não entendi a data. Diga por exemplo "amanhã", "sexta-feira", "15 de julho" ou "em 3 dias".', () => listenAfterSpeak(200));
          return;
        }
        lemRef.current.data = dataStr;
        setLemCollected(p => ({ ...p, data: dataStr }));
        setVsStateBoth(VS.LEM_HORA);
        speak(`${dataStr}. Que horas?`, () => listenAfterSpeak(400));
        break;
      }

      // ── Etapa 3: horário do lembrete ──────────────────────────────────────
      case VS.LEM_HORA: {
        const horaStr = parseHorarioVoz(text) || '10:00';
        lemRef.current.hora = horaStr;
        setLemCollected(p => ({ ...p, hora: horaStr }));
        setVsStateBoth(VS.LEM_CONFIRM);
        const [hh, mm] = horaStr.split(':');
        const horaFalada = mm === '00' ? `${parseInt(hh)} horas` : `${parseInt(hh)} e ${mm} minutos`;
        speak(`"${lemRef.current.texto}", ${lemRef.current.data} às ${horaFalada}. Confirma?`, () => listenAfterSpeak(450));
        break;
      }

      // ── Etapa 4: confirmar e salvar lembrete ──────────────────────────────
      case VS.LEM_CONFIRM: {
        const n2 = stripAccents(text.toLowerCase());
        const confirmou = /(sim|confirma|confirmo|pode|ok|isso|certo|correto|salva|salvar|perfeito|exato|ótimo|otimo|com certeza)/.test(n2);
        const cancelou  = /(nao|não|cancela|cancelo|errado|errada|muda|mudar|corrige|corrigir|volta|voltar)/.test(n2);
        if (cancelou) {
          lemRef.current = { texto:'', data:'', hora:'10:00' };
          setLemCollected({ texto:'', data:'', hora:'' });
          setVsStateBoth(VS.IDLE);
          speak('Lembrete cancelado. Diga o que quiser fazer.', () => listenAfterSpeak());
          return;
        }
        if (!confirmou) {
          speak('Não entendi. Diga "sim" para confirmar ou "cancelar" para desistir.', () => listenAfterSpeak());
          return;
        }
        // Salva lembrete
        (async () => {
          try {
            const granted = await requestNotifPermission();
            if (!granted) {
              // requestNotifPermission já mostrou Alert com opção de abrir configurações
              // Encerra o fluxo de voz e fecha o assistente
              speak('Para eu te avisar, você precisa autorizar as notificações. Verifique as configurações do seu aparelho.', () => {
                setTimeout(() => onClose(), 2200);
              });
              setVsStateBoth(VS.IDLE);
              return;
            }
            await initNotifChannel();
            const notifId = await scheduleCustomLembrete(lemRef.current.texto, lemRef.current.hora, lemRef.current.data || null);
            if (!notifId) {
              speak('Não consegui agendar. O horário já passou. Tente um horário futuro.', () => listenAfterSpeak());
              setVsStateBoth(VS.IDLE);
              return;
            }
            const lista = await getLembretes();
            const novo = { id:`voice-${Date.now()}`, produto: lemRef.current.texto, validade: lemRef.current.data || '', notifId, horario: lemRef.current.hora, tipo:'personalizado', criadoEm: new Date().toISOString() };
            await saveLembretes([novo, ...lista]);
            setVsStateBoth(VS.IDLE);
            const [hh2, mm2] = lemRef.current.hora.split(':');
            const horaF = mm2 === '00' ? `${parseInt(hh2)} horas` : `${parseInt(hh2)} e ${mm2}`;
            speak(`Lembrete salvo com sucesso! Vou te avisar no dia ${lemRef.current.data} às ${horaF}.`, () => {
              // Fecha o assistente de voz após confirmar o salvamento
              setTimeout(() => onClose(), 400);
            });
            lemRef.current = { texto:'', data:'', hora:'10:00' };
            setLemCollected({ texto:'', data:'', hora:'' });
          } catch (e) {
            speak('Erro ao salvar o lembrete. Tente novamente.', () => listenAfterSpeak());
            setVsStateBoth(VS.IDLE);
          }
        })();
        break;
      }
      case VS.PROD: {
        const lower = stripAccents(text);
        if (lower.length < 2 || detectWakeWord(text)) { listenAfterSpeak(250); return; }
        const nome = text.trim().toUpperCase();
        dataRef.current.nome = nome;
        setCollected(p => ({ ...p, nome }));
        setVsStateBoth(VS.DATE);
        speak(`${nome}. Qual a data de vencimento?`, () => listenAfterSpeak());
        break;
      }
      case VS.DATE: {
        let date = parsePortugueseDate(text);
        if (date) {
          // ✅ Correção inteligente centralizada: corrige ano, mês/dia invertidos, clamp
          date = smartCorrectDate(date);
        }
        if (!date) {
          speak('Não entendi a data. Diga por exemplo "11 de julho de 2026" ou apenas "junho 2026".', () => listenAfterSpeak(400));
          return;
        }
        dataRef.current.date = date;
        setCollected(p => ({ ...p, date }));
        dataRef.current.giro = 'Médio giro';
        setCollected(p => ({ ...p, giro: 'Médio giro' }));
        setVsStateBoth(VS.CONFIRM);
        const d0 = dataRef.current;
        speak(`Vencimento ${date}. Confirme: produto ${d0.nome}, vencimento ${date}. Está correto? Diga sim ou corrigir.`, () => listenAfterSpeak(200));
        break;
      }
      case VS.CONFIRM: {
        if (isConfirmCmd(text)) {
          // FIFO: nome (primeiros 6 chars) ou EAN igual
          const d = dataRef.current;
          const nomeLow = stripAccents((d.nome || '').toLowerCase());
          const fifoHit = (stockData || []).find(function(p) {
            const pNome = stripAccents((p.produto || '').toLowerCase());
            const eanOk = scannedEAN && scannedEAN !== 'Sem EAN' && String(p.codig||''). trim() === String(scannedEAN).trim();
            const nameOk = nomeLow.length >= 4 && pNome.startsWith(nomeLow.substring(0, Math.min(6, nomeLow.length)));
            return eanOk || nameOk;
          });
          if (fifoHit) {
            fifoExistingRef.current = fifoHit;
            setVsStateBoth(VS.FIFO_MATCH);
            speak(
              'Ja existe ' + fifoHit.produto + ' cadastrado. Quer cadastrar novo lote ou alterar o existente? Diga novo lote ou alterar.',
              () => listenAfterSpeak()
            );
          } else {
            setVsStateBoth(VS.SAVING);
            triggerSaveAnimation();
            // ✅ Salva campos IMEDIATAMENTE antes do TTS (evita crash se componente desmontar)
            try {
              setProdName(d.nome); setValidade(d.date);
              setWStep(1);
              onComplete({ nome:d.nome, qty:d.qty, date:d.date, giro:d.giro });
            } catch { /* noop */ }
            speak('Salvo!', () => {
              if (visibleRef.current) setTimeout(() => onClose(), 300);
            });
          }
        } else if (isCorrectCmd(text)) {
          setVsStateBoth(VS.PROD);
          dataRef.current = { nome:'', qty:'', date:'', giro:'Médio giro' };
          setCollected({ nome:'', qty:'', date:'', giro:'' });
          speak('Ok, vamos recomeçar. Qual o nome do produto?', () => listenAfterSpeak());
        } else {
          speak('Diga "sim" para confirmar ou "corrigir" para refazer.', () => listenAfterSpeak());
        }
        break;
      }
      case VS.FIFO_MATCH: {
        const lf = stripAccents(text.toLowerCase());
        if (/(novo|lote|novo lote|outro|adicionar|cadastrar|sim|confirma)/.test(lf)) {
          const df = dataRef.current;
          setVsStateBoth(VS.SAVING); triggerSaveAnimation();
          try { setProdName(df.nome); setValidade(df.date); setWStep(1); onComplete({ nome:df.nome, qty:df.qty, date:df.date, giro:df.giro }); } catch { /* noop */ }
          speak('Novo lote salvo!', () => { if (visibleRef.current) setTimeout(() => onClose(), 600); });
        } else if (/(alterar|mudar|editar|corrigir|trocar|modificar|atualizar)/.test(lf)) {
          setVsStateBoth(VS.EDIT_WHAT);
          speak('O que quer alterar? Diga nome, quantidade, data de vencimento ou giro.', () => listenAfterSpeak());
        } else {
          speak('Diga novo lote para cadastrar um novo ou alterar para modificar o existente.', () => listenAfterSpeak());
        }
        break;
      }
      case VS.EDIT_WHAT: {
        const lw = stripAccents(text.toLowerCase());
        if (/(confirmar|pronto|ok|salvar|finalizar|terminar|tudo certo)/.test(lw)) {
          const dw = dataRef.current; const ex = fifoExistingRef.current;
          setVsStateBoth(VS.SAVING); triggerSaveAnimation();
          (async () => {
            try {
              if (ex && doUpdateExisting) { await doUpdateExisting(ex.id, dw); }
              else { setProdName(dw.nome); setValidade(dw.date); setWStep(1); onComplete({ nome:dw.nome, qty:dw.qty, date:dw.date, giro:dw.giro }); }
            } catch { /* noop */ }
          })();
          speak('Alterações salvas!', () => { if (visibleRef.current) setTimeout(() => onClose(), 600); });
        } else if (/(nome|produto|descri|chamado)/.test(lw)) {
          editingFieldRef.current = 'nome';
          speak('Qual o novo nome do produto?', () => listenAfterSpeak()); setVsStateBoth(VS.EDIT_VALUE);
        } else if (/(data|validade|vencimento|vence)/.test(lw)) {
          editingFieldRef.current = 'date';
          speak('Qual a nova data de vencimento?', () => listenAfterSpeak()); setVsStateBoth(VS.EDIT_VALUE);
        } else {
          speak('Diga o campo: nome ou data de vencimento. Ou diga confirmar para salvar.', () => listenAfterSpeak());
        }
        break;
      }
      case VS.EDIT_VALUE: {
        const fld = editingFieldRef.current;
        if (fld === 'nome') {
          const nn = text.trim().toUpperCase();
          dataRef.current.nome = nn; setCollected(p => ({ ...p, nome: nn }));
          speak('Nome alterado para ' + nn + '. Quer alterar mais alguma coisa ou confirmar?', () => listenAfterSpeak());
          setVsStateBoth(VS.EDIT_WHAT);
        } else if (fld === 'date') {
          let nd = parsePortugueseDate(text);
          if (nd) nd = smartCorrectDate(nd);
          if (!nd) { speak('Nao entendi a data. Diga por exemplo 11 de julho de 2026.', () => listenAfterSpeak(250)); return; }
          dataRef.current.date = nd; setCollected(p => ({ ...p, date: nd }));
          speak('Data alterada para ' + nd + '. Quer alterar mais alguma coisa ou confirmar?', () => listenAfterSpeak());
          setVsStateBoth(VS.EDIT_WHAT);
        } else { listenAfterSpeak(250); }
        break;
      }
    }
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible; // ✅ sempre sincronizado com prop visible
    if (visible) {
      closingRef.current = false;  // ✅ reset da trava de fechamento ao abrir
      slideA.setValue(WIN.height); opacA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA, { toValue:0, tension:65, friction:11, useNativeDriver:false }),
        Animated.timing(opacA,  { toValue:1, duration:280, useNativeDriver:false }),
      ]).start();
      dataRef.current = { nome:'', qty:'', date:'', giro:'Médio giro' };
      setCollected({ nome:'', qty:'', date:'', giro:'' });
      setTranscript(''); setErrorMsg(''); retryRef.current = 0;
      isStartingMicRef.current = false; // ✅ limpa guard ao abrir
      lastRestartRef.current   = 0;     // ✅ zera cooldown ao abrir
      if (fromWakeWord) {
        // Wake word ja detectado: pula IDLE, ativa mic e vai direto para cadastro
        setVsStateBoth(VS.PROD);
        speak('Pronto! Qual o nome do produto que deseja cadastrar?', () => listenAfterSpeak(450));
      } else {
        setVsStateBoth(VS.IDLE);
        speak('GEI Assistant ativado. Diga "cadastrar produto" para começar.', () => {
          if (voiceEngineRef.current === 'native') listenAfterSpeak(200);
        });
      }
    } else {
      // ✅ TRAVA DEFINITIVA: qualquer callback pendente que cheque closingRef vai abortar
      closingRef.current = true;
      // ✅ Cancela ABSOLUTAMENTE TODOS os timers e estados pendentes
      // 1. Para TTS imediatamente — evita que o onDone dispare listenAfterSpeak após fechar
      isTtsActiveRef.current = false;
      try { Speech.stop(); } catch { /* noop */ }
      // 2. Cancela timers de auto-restart
      if (autoRestartRef.current) { clearTimeout(autoRestartRef.current); autoRestartRef.current = null; }
      // 3. Cancela TODOS os timers de listenAfterSpeak
      listenTimeoutsRef.current.forEach(t => clearTimeout(t));
      listenTimeoutsRef.current = [];
      // 4. Reseta guards de concorrência
      isStartingMicRef.current = false;
      // 5. Para gravação Deepgram se ativa
      if (recordingRef.current) { recordingRef.current.stopAndUnloadAsync().catch(()=>{}); recordingRef.current = null; }
      // 6. Para reconhecimento nativo (o `end` vai disparar mas visibleRef.current=false já bloqueia o restart)
      stopNativeListening();
      stopPulse();
      setVsStateBoth(VS.IDLE); // ✅ força IDLE para bloquear _scheduleRestart via vsStateRef
      setIsRecording(false); setListening(false); setIsProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const isActive = isRecording || listening;
  const isLembreteFlow = [VS.LEM_TEXTO, VS.LEM_DATA, VS.LEM_HORA, VS.LEM_CONFIRM].includes(vsState);

  const STEP_LABELS     = isLembreteFlow
    ? ['Ativação','Texto','Data','Horário','Confirmar']
    : ['Ativação','Produto','Qtd.','Data','Giro','Confirmar'];
  const STATE_IDX = {
    [VS.IDLE]:0, [VS.PROD]:1, [VS.QTY]:2,
    [VS.DATE]:3, [VS.GIRO]:4, [VS.CONFIRM]:5, [VS.SAVING]:5,
    [VS.FIFO_MATCH]:5, [VS.EDIT_WHAT]:5, [VS.EDIT_VALUE]:5,
    // ── Lembrete ──
    [VS.LEM_TEXTO]:1, [VS.LEM_DATA]:2, [VS.LEM_HORA]:3, [VS.LEM_CONFIRM]:4,
  };
  const stepIdx = STATE_IDX[vsState] ?? 0;
  const STATE_LABEL = {
    [VS.IDLE]:'Diga "cadastrar produto" ou "me lembre de..."',
    [VS.PROD]:'Diga o nome do produto',
    [VS.QTY]:'Diga a quantidade',
    [VS.DATE]:'Diga a data de vencimento',
    [VS.GIRO]:'Pouco, médio ou grande giro?',
    [VS.CONFIRM]:'Confirme ou peça para corrigir',
    [VS.SAVING]:'Salvando...',
    [VS.FIFO_MATCH]:'Produto existente — novo lote ou alterar?',
    [VS.EDIT_WHAT]:'O que quer alterar?',
    [VS.EDIT_VALUE]:'Diga o novo valor',
    // ── Lembrete ──
    [VS.LEM_TEXTO]:'Descreva o lembrete',
    [VS.LEM_DATA]:'Para qual data?',
    [VS.LEM_HORA]:'Que horas devo avisar?',
    [VS.LEM_CONFIRM]:'Confirme o lembrete',
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <>
        {voiceEngine === 'native' && (
          <>
            <_SafeSpeechEventWrapper eventName="start" onEvent={onSpeechStart} />
            <_SafeSpeechEventWrapper eventName="end"   onEvent={onSpeechEnd} />
            <_SafeSpeechEventWrapper eventName="result" onEvent={onSpeechResult} />
            <_SafeSpeechEventWrapper eventName="error"  onEvent={onSpeechError} />
          </>
        )}
        <View style={{ flex:1, backgroundColor: isLembreteFlow ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.88)', justifyContent:'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

          {/* ══════════════════════════════════════════════════════════════════
              MODAL LEMBRETE — layout completamente separado, estilo âmbar
          ══════════════════════════════════════════════════════════════════ */}
          {isLembreteFlow ? (
            <Animated.View style={{
              backgroundColor: T.bgCard,
              borderTopLeftRadius:40, borderTopRightRadius:40,
              paddingHorizontal:20, paddingTop:0, paddingBottom:32 + NAV_BAR_H,
              borderTopWidth:2.5, borderColor:'#F59E0B80',
              transform:[{ translateY:slideA }], opacity:opacA,
              shadowColor:'#F59E0B', shadowOffset:{width:0,height:-10},
              shadowOpacity:0.35, shadowRadius:30, elevation:36,
            }}>

              {/* ── Tarja superior âmbar com ícone de sino ── */}
              <View style={{
                backgroundColor:'#F59E0B', borderTopLeftRadius:38, borderTopRightRadius:38,
                paddingTop:16, paddingBottom:20, paddingHorizontal:22,
                alignItems:'center', marginBottom:0,
              }}>
                {/* Handle */}
                <View style={{ width:40, height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.4)', marginBottom:14 }} />
                {/* Ícone + título */}
                <View style={{ flexDirection:'row', alignItems:'center', gap:12 }}>
                  <Animated.View style={{
                    width:54, height:54, borderRadius:18,
                    backgroundColor: isActive ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)',
                    justifyContent:'center', alignItems:'center',
                    borderWidth:2, borderColor:'rgba(255,255,255,0.35)',
                    transform:[{ scale:pulseA }],
                    shadowColor:'#000', shadowOpacity:isActive?0.4:0, shadowRadius:10,
                  }}>
                    {isProcessing
                      ? <ActivityIndicator size="small" color="#FFF" />
                      : <MaterialCommunityIcons
                          name={isActive ? 'microphone' : 'bell-ring'}
                          size={26} color="#FFF"
                        />
                    }
                  </Animated.View>
                  <View style={{ flex:1 }}>
                    <Text style={{ fontSize:9*fontScale, fontWeight:'900', color:'rgba(255,255,255,0.75)', textTransform:'uppercase', letterSpacing:1.6 }}>
                      {isProcessing ? '⚙️  PROCESSANDO' : isActive ? '🔴  OUVINDO' : '🔔  NOVO LEMBRETE'}
                    </Text>
                    <Text style={{ fontSize:15*fontScale, fontWeight:'900', color:'#FFF', marginTop:3 }} numberOfLines={1}>
                      {STATE_LABEL[vsState]}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={onClose} style={{ width:34, height:34, borderRadius:12, backgroundColor:'rgba(0,0,0,0.18)', justifyContent:'center', alignItems:'center' }}>
                    <Feather name="x" size={16} color="#FFF" />
                  </TouchableOpacity>
                </View>

                {/* ── Progress steps âmbar ── */}
                <View style={{ flexDirection:'row', marginTop:18, width:'100%' }}>
                  {['Texto','Data','Horário','Confirmar'].map((l,i) => {
                    const si = stepIdx - 1; // stepIdx começa em 1 para lembrete
                    const done = si > i, active = si === i;
                    return (
                      <View key={i} style={{ flex:1, alignItems:'center' }}>
                        {i>0 && <View style={{ position:'absolute', top:11, left:0, right:'50%', height:2, backgroundColor:si>=i?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.25)' }} />}
                        {i<3    && <View style={{ position:'absolute', top:11, left:'50%', right:0, height:2, backgroundColor:si>i?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.25)' }} />}
                        <View style={{
                          width:22, height:22, borderRadius:11, zIndex:1,
                          backgroundColor: done ? 'rgba(255,255,255,0.9)' : active ? '#FFF' : 'rgba(255,255,255,0.2)',
                          justifyContent:'center', alignItems:'center',
                          borderWidth:1.5, borderColor: active ? '#FFF' : 'transparent',
                        }}>
                          {done
                            ? <Feather name="check" size={11} color="#F59E0B" />
                            : <Text style={{ fontSize:9, fontWeight:'900', color: active?'#F59E0B':'rgba(255,255,255,0.6)' }}>{i+1}</Text>
                          }
                        </View>
                        <Text style={{ fontSize:8*fontScale, marginTop:4, color: active||done ? '#FFF' : 'rgba(255,255,255,0.55)', fontWeight: active?'900':'600', textAlign:'center' }}>{l}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Corpo do modal ── */}
              <View style={{ paddingHorizontal:2, paddingTop:16, gap:10 }}>

                {/* Cards de campos coletados */}
                <View style={{ gap:8 }}>
                  {[
                    { key:'texto', label:'Lembrete',  icon:'bell',     emoji:'📝', empty:'Diga o que quer lembrar...' },
                    { key:'data',  label:'Data',      icon:'calendar', emoji:'📅', empty:'Amanhã, sexta-feira, 15 de julho...' },
                    { key:'hora',  label:'Horário',   icon:'clock',    emoji:'⏰', empty:'8 da manhã, 2 da tarde, 8 da noite...' },
                  ].map((f, idx) => {
                    const isCurrentStep = (
                      (f.key === 'texto' && vsState === VS.LEM_TEXTO) ||
                      (f.key === 'data'  && vsState === VS.LEM_DATA)  ||
                      (f.key === 'hora'  && vsState === VS.LEM_HORA)  ||
                      (vsState === VS.LEM_CONFIRM)
                    );
                    const haVal = !!lemCollected[f.key];
                    return (
                      <View key={f.key} style={{
                        flexDirection:'row', alignItems:'center',
                        backgroundColor: haVal ? '#F59E0B12' : (isCurrentStep ? '#F59E0B08' : T.bgElevated),
                        borderRadius:16, padding:14, gap:12,
                        borderWidth:1.5,
                        borderColor: haVal ? '#F59E0B50' : (isCurrentStep ? '#F59E0B30' : T.border),
                      }}>
                        <View style={{
                          width:40, height:40, borderRadius:13,
                          backgroundColor: haVal ? '#F59E0B22' : (isCurrentStep ? '#F59E0B15' : T.bgInput),
                          justifyContent:'center', alignItems:'center',
                        }}>
                          {isCurrentStep && isActive && !haVal
                            ? <Animated.View style={{ transform:[{scale:pulseA}] }}>
                                <Text style={{ fontSize:18 }}>{f.emoji}</Text>
                              </Animated.View>
                            : <Text style={{ fontSize:18 }}>{haVal ? f.emoji : f.emoji}</Text>
                          }
                        </View>
                        <View style={{ flex:1 }}>
                          <Text style={{ fontSize:10*fontScale, fontWeight:'900', color: haVal ? '#F59E0B' : T.textMuted, textTransform:'uppercase', letterSpacing:0.8, marginBottom:3 }}>
                            {f.label}
                          </Text>
                          <Text style={{ fontSize:13*fontScale, fontWeight: haVal ? '800' : '500', color: haVal ? T.text : T.textMuted }} numberOfLines={2}>
                            {lemCollected[f.key] || f.empty}
                          </Text>
                        </View>
                        {haVal && (
                          <View style={{ width:26, height:26, borderRadius:13, backgroundColor:'#F59E0B20', justifyContent:'center', alignItems:'center' }}>
                            <Feather name="check" size={13} color="#F59E0B" />
                          </View>
                        )}
                        {isCurrentStep && !haVal && (
                          <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#F59E0B', opacity: isActive ? 1 : 0.4 }} />
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Atalhos rápidos de período — visíveis só na etapa de horário */}
                {vsState === VS.LEM_HORA && (
                  <View style={{ gap:6 }}>
                    <Text style={{ fontSize:10*fontScale, fontWeight:'900', color:T.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:2 }}>
                      Atalhos rápidos
                    </Text>
                    <View style={{ flexDirection:'row', gap:8 }}>
                      {[
                        { label:'Manhã',  hora:'08:00', emoji:'🌅', voz:'8h00' },
                        { label:'Tarde',  hora:'14:00', emoji:'☀️', voz:'14h00' },
                        { label:'Noite',  hora:'20:00', emoji:'🌙', voz:'20h00' },
                      ].map(a => (
                        <TouchableOpacity key={a.hora}
                          onPress={() => handleVoiceInput(a.voz)}
                          activeOpacity={0.75}
                          style={{
                            flex:1, paddingVertical:11, borderRadius:14,
                            backgroundColor: T.bgElevated,
                            borderWidth:1.5, borderColor:'#F59E0B30',
                            alignItems:'center', gap:4,
                          }}>
                          <Text style={{ fontSize:20 }}>{a.emoji}</Text>
                          <Text style={{ fontSize:11*fontScale, fontWeight:'800', color:T.text }}>{a.label}</Text>
                          <Text style={{ fontSize:10*fontScale, fontWeight:'700', color:'#F59E0B' }}>{a.hora}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Transcrição / erro */}
                {(transcript || errorMsg) ? (
                  <View style={{ backgroundColor: errorMsg ? T.redGlow : '#F59E0B14', borderRadius:14, padding:12, borderWidth:1, borderColor: errorMsg ? T.red+'30' : '#F59E0B30' }}>
                    <Text style={{ fontSize:13*fontScale, color: errorMsg ? T.red : '#B45309', fontWeight:'800', textAlign:'center', fontStyle:'italic' }} numberOfLines={2}>
                      {errorMsg || `"${transcript}"`}
                    </Text>
                  </View>
                ) : null}

                {/* Seletor motor */}
                <View style={{ flexDirection:'row', backgroundColor:T.bgInput, borderRadius:14, padding:3 }}>
                  {[{key:'deepgram',label:'☁️ Deepgram',sub:'Expo Go'},{key:'native',label:'📱 Nativo',sub:'Build'}].map(opt => {
                    const on = voiceEngine === opt.key;
                    return (
                      <TouchableOpacity key={opt.key}
                        onPress={() => { setVoiceEngine(opt.key); voiceEngineRef.current = opt.key; setErrorMsg(''); setTranscript(''); }}
                        style={{ flex:1, paddingVertical:8, borderRadius:11, alignItems:'center', backgroundColor:on?'#F59E0B':'transparent' }}>
                        <Text style={{ fontSize:11*fontScale, fontWeight:'800', color:on?'#FFF':T.textSub }}>{opt.label}</Text>
                        <Text style={{ fontSize:8*fontScale, color:on?'rgba(255,255,255,0.7)':T.textMuted, marginTop:1 }}>{opt.sub}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Botão mic Deepgram */}
                {voiceEngine === 'deepgram' && (
                  <TouchableOpacity onPress={micPress} disabled={isProcessing} activeOpacity={0.82}
                    style={{ height:54, borderRadius:18, justifyContent:'center', alignItems:'center', flexDirection:'row', gap:10,
                      backgroundColor: isProcessing ? T.amber : (isRecording ? T.red : '#F59E0B'),
                      shadowColor: isRecording ? T.red : '#F59E0B', shadowOpacity:0.45, shadowRadius:14, elevation:8, opacity: isProcessing ? 0.9 : 1 }}>
                    {isProcessing ? <ActivityIndicator color="#FFF" /> : <MaterialCommunityIcons name={isRecording?'stop-circle':'microphone'} size={22} color="#FFF" />}
                    <Text style={{ color:'#FFF', fontSize:15*fontScale, fontWeight:'900' }}>
                      {isProcessing ? 'Transcrevendo...' : isRecording ? 'Parar e Enviar' : 'Toque para Falar'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Ações */}
                <View style={{ flexDirection:'row', gap:8 }}>
                  <TouchableOpacity onPress={() => handleVoiceInput('cancelar')}
                    style={{ flex:1, height:48, borderRadius:14, backgroundColor:T.redGlow, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:T.red+'30' }}>
                    <Text style={{ color:T.red, fontWeight:'800', fontSize:13*fontScale }}>✕ Cancelar</Text>
                  </TouchableOpacity>
                  {vsState === VS.LEM_CONFIRM && (
                    <>
                      <TouchableOpacity onPress={() => handleVoiceInput('sim')}
                        style={{ flex:2, height:48, borderRadius:14, backgroundColor:'#F59E0B', justifyContent:'center', alignItems:'center', shadowColor:'#F59E0B', shadowOpacity:0.45, shadowRadius:10, elevation:6, flexDirection:'row', gap:8 }}>
                        <Feather name="bell" size={16} color="#FFF" />
                        <Text style={{ color:'#FFF', fontWeight:'900', fontSize:15*fontScale }}>Salvar Lembrete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleVoiceInput('corrigir')}
                        style={{ flex:1, height:48, borderRadius:14, backgroundColor:T.bgElevated, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:'#F59E0B40' }}>
                        <Text style={{ color:'#F59E0B', fontWeight:'800', fontSize:12*fontScale }}>Corrigir</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>

              {/* ── Animação de sucesso (lembrete) ── */}
              {showSaveAnim && (
                <Animated.View style={{
                  position:'absolute', top:0, left:0, right:0, bottom:0,
                  borderRadius:40, backgroundColor:'rgba(15,10,0,0.97)',
                  justifyContent:'center', alignItems:'center',
                  opacity:sOpac, zIndex:999,
                }}>
                  <Animated.View style={{ position:'absolute', width:180, height:180, borderRadius:90, borderWidth:2.5, borderColor:'#F59E0B', transform:[{scale:sRing1}], opacity:sRingO1 }} />
                  <Animated.View style={{ position:'absolute', width:240, height:240, borderRadius:120, borderWidth:1.5, borderColor:'#F59E0B80', transform:[{scale:sRing2}], opacity:sRingO2 }} />
                  <Animated.View style={{ width:138, height:138, borderRadius:69, backgroundColor:'#F59E0B20', borderWidth:3.5, borderColor:'#F59E0B', justifyContent:'center', alignItems:'center', transform:[{scale:sCircle}], shadowColor:'#F59E0B', shadowOpacity:1, shadowRadius:55, elevation:30 }}>
                    <Animated.View style={{transform:[{scale:sCheck}]}}>
                      <MaterialCommunityIcons name="bell-check" size={60} color="#F59E0B" />
                    </Animated.View>
                  </Animated.View>
                  {['⏰','🔔','📅','✨','⭐','🌟','💫','🔔'].map((e,i) => (
                    <Animated.Text key={i} style={{ position:'absolute', fontSize:22, opacity:sPartO, transform:[{scale:sPartS}],
                      ...[{top:-90,left:20},{top:-65,right:-50},{top:15,right:-95},{bottom:-75,right:-15},{bottom:-60,left:-55},{top:25,left:-95},{top:-80,left:-45},{bottom:-35,right:-75}][i] }}>
                      {e}
                    </Animated.Text>
                  ))}
                  <Animated.Text style={{ fontSize:26, fontWeight:'900', color:'#FFF', marginTop:26, opacity:sTextO, transform:[{translateY:sTextY}] }}>
                    Lembrete Salvo! 🔔
                  </Animated.Text>
                  <Animated.Text style={{ fontSize:13, color:'#F59E0B', fontWeight:'700', marginTop:8, opacity:sSubTextO }}>
                    Vou te avisar na hora certa
                  </Animated.Text>
                </Animated.View>
              )}
            </Animated.View>

          ) : (
          /* ══════════════════════════════════════════════════════════════════
              MODAL PADRÃO — cadastro de produto (layout original mantido)
          ══════════════════════════════════════════════════════════════════ */
          <Animated.View style={{
            backgroundColor:T.bgCard, borderTopLeftRadius:36, borderTopRightRadius:36,
            paddingHorizontal:22, paddingTop:14, paddingBottom:32 + NAV_BAR_H,
            borderTopWidth:2, borderColor:T.blue+'50',
            transform:[{ translateY:slideA }], opacity:opacA,
            shadowColor:'#000', shadowOffset:{width:0,height:-14},
            shadowOpacity:0.55, shadowRadius:28, elevation:32,
          }}>

            {/* Handle */}
            <View style={{ width:44, height:5, borderRadius:3, backgroundColor:T.border, alignSelf:'center', marginBottom:16 }} />

            {/* Header */}
            <View style={{ flexDirection:'row', alignItems:'center', marginBottom:18, gap:14 }}>
              <Animated.View style={{
                width:52, height:52, borderRadius:16,
                backgroundColor: isActive ? T.blue : (isProcessing ? T.amber : T.bgInput),
                justifyContent:'center', alignItems:'center',
                borderWidth:2, borderColor: isActive ? T.blue+'50' : T.border,
                transform:[{ scale:pulseA }],
                shadowColor:T.blue, shadowOpacity:isActive?0.55:0, shadowRadius:14, elevation:isActive?10:0,
              }}>
                {isProcessing
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <MaterialCommunityIcons
                      name={isActive ? 'microphone' : 'microphone-off'}
                      size={26}
                      color={isActive ? '#FFF' : T.textMuted}
                    />
                }
              </Animated.View>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:10*fontScale, fontWeight:'900', color: isProcessing ? T.amber : (isActive ? T.blue : T.textMuted), textTransform:'uppercase', letterSpacing:1.4 }}>
                  {isProcessing ? '⚙️  PROCESSANDO' : isActive ? '🔴  OUVINDO' : '🔵  GEI ASSISTANT'}
                </Text>
                <Text style={{ fontSize:13*fontScale, fontWeight:'800', color:T.text, marginTop:3 }} numberOfLines={1}>
                  {STATE_LABEL[vsState]}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ width:36, height:36, borderRadius:12, backgroundColor:T.bgInput, justifyContent:'center', alignItems:'center' }}>
                <Feather name="x" size={17} color={T.textSub} />
              </TouchableOpacity>
            </View>

            {/* Seletor de motor */}
            <View style={{ flexDirection:'row', backgroundColor:T.bgInput, borderRadius:14, padding:3, marginBottom:14 }}>
              {[{key:'deepgram',label:'☁️ Deepgram',sub:'Expo Go'},{key:'native',label:'📱 Nativo',sub:'Build'}].map(opt => {
                const on = voiceEngine === opt.key;
                return (
                  <TouchableOpacity key={opt.key}
                    onPress={() => { setVoiceEngine(opt.key); voiceEngineRef.current = opt.key; setErrorMsg(''); setTranscript(''); }}
                    style={{ flex:1, paddingVertical:9, borderRadius:11, alignItems:'center', backgroundColor:on?T.blue:'transparent' }}>
                    <Text style={{ fontSize:12*fontScale, fontWeight:'800', color:on?'#FFF':T.textSub }}>{opt.label}</Text>
                    <Text style={{ fontSize:9*fontScale, color:on?'rgba(255,255,255,0.7)':T.textMuted, marginTop:1 }}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Dados coletados */}
            <View style={{ backgroundColor:T.bgElevated, borderRadius:20, padding:14, marginBottom:14, gap:8, borderWidth:1, borderColor:T.border }}>
              {[
                { key:'nome',  label:'Produto',    icon:'package',    empty:'Aguardando...' },
                { key:'date',  label:'Vencimento', icon:'calendar',   empty:'Aguardando...' },
              ].map(f => (
                <View key={f.key} style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                  <View style={{ width:32, height:32, borderRadius:10, backgroundColor:collected[f.key]?T.blue+'22':T.bgInput, justifyContent:'center', alignItems:'center' }}>
                    <Feather name={f.icon} size={15} color={collected[f.key]?T.blue:T.textMuted} />
                  </View>
                  <Text style={{ fontSize:11*fontScale, fontWeight:'700', color:T.textMuted, width:76 }}>{f.label}</Text>
                  <Text style={{ fontSize:13*fontScale, fontWeight:collected[f.key]?'900':'500', color:collected[f.key]?T.text:T.textMuted, flex:1 }} numberOfLines={1}>
                    {collected[f.key] || f.empty}
                  </Text>
                  {collected[f.key] && <Feather name="check-circle" size={14} color={T.green} />}
                </View>
              ))}
            </View>

            {/* Transcrição / erro */}
            {(transcript || errorMsg) ? (
              <View style={{ backgroundColor:errorMsg?T.redGlow:T.blue+'14', borderRadius:14, padding:12, marginBottom:12, borderWidth:1, borderColor:errorMsg?T.red+'30':T.blue+'25' }}>
                <Text style={{ fontSize:13*fontScale, color:errorMsg?T.red:T.blue, fontWeight:'800', textAlign:'center', fontStyle:'italic' }} numberOfLines={2}>
                  {errorMsg || `"${transcript}"`}
                </Text>
              </View>
            ) : null}

            {/* Progress steps */}
            <View style={{ flexDirection:'row', marginBottom:16 }}>
              {STEP_LABELS.map((l,i) => (
                <View key={i} style={{ flex:1, alignItems:'center' }}>
                  {i>0 && <View style={{ position:'absolute', top:13, left:0, right:'50%', height:2, backgroundColor:i<=stepIdx?T.blue:T.border }} />}
                  {i<STEP_LABELS.length-1 && <View style={{ position:'absolute', top:13, left:'50%', right:0, height:2, backgroundColor:i<stepIdx?T.blue:T.border }} />}
                  <View style={{
                    width:26, height:26, borderRadius:13, zIndex:1,
                    backgroundColor:stepIdx>i?T.green:(stepIdx===i?T.blue:T.bgInput),
                    justifyContent:'center', alignItems:'center',
                    borderWidth:1.5, borderColor:stepIdx>=i?'transparent':T.border,
                  }}>
                    {stepIdx>i
                      ? <Feather name="check" size={12} color="#FFF" />
                      : <Text style={{ fontSize:9, fontWeight:'900', color:stepIdx===i?'#FFF':T.textMuted }}>{i+1}</Text>
                    }
                  </View>
                  <Text style={{ fontSize:7*fontScale, marginTop:4, color:stepIdx>=i?T.blue:T.textMuted, fontWeight:stepIdx===i?'900':'600', textAlign:'center' }}>{l}</Text>
                </View>
              ))}
            </View>

            {/* Botão principal Deepgram */}
            {voiceEngine === 'deepgram' && (
              <TouchableOpacity
                onPress={micPress}
                disabled={isProcessing}
                activeOpacity={0.82}
                style={{
                  height:56, borderRadius:18, justifyContent:'center', alignItems:'center',
                  flexDirection:'row', gap:10, marginBottom:10,
                  backgroundColor: isProcessing ? T.amber : (isRecording ? T.red : T.blue),
                  shadowColor: isRecording ? T.red : T.blue,
                  shadowOpacity:0.45, shadowRadius:14, elevation:8,
                  opacity: isProcessing ? 0.9 : 1,
                }}
              >
                {isProcessing
                  ? <ActivityIndicator color="#FFF" />
                  : <MaterialCommunityIcons name={isRecording?'stop-circle':'microphone'} size={22} color="#FFF" />
                }
                <Text style={{ color:'#FFF', fontSize:15*fontScale, fontWeight:'900' }}>
                  {isProcessing ? 'Transcrevendo...' : isRecording ? 'Parar e Enviar' : 'Toque para Falar'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Ações rápidas */}
            <View style={{ flexDirection:'row', gap:8 }}>
              <TouchableOpacity
                onPress={() => handleVoiceInput('cancelar')}
                style={{ flex:1, height:46, borderRadius:14, backgroundColor:T.redGlow, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:T.red+'30' }}>
                <Text style={{ color:T.red, fontWeight:'800', fontSize:13*fontScale }}>✕ Cancelar</Text>
              </TouchableOpacity>

              {(vsState === VS.CONFIRM || vsState === VS.LEM_CONFIRM) && (
                <TouchableOpacity
                  onPress={() => handleVoiceInput('sim')}
                  style={{ flex:2, height:46, borderRadius:14, backgroundColor: vsState === VS.LEM_CONFIRM ? T.amber : T.green, justifyContent:'center', alignItems:'center', shadowColor: vsState === VS.LEM_CONFIRM ? T.amber : T.green, shadowOpacity:0.4, shadowRadius:8, elevation:4 }}>
                  <Text style={{ color:'#FFF', fontWeight:'900', fontSize:14*fontScale }}>✓ Confirmar</Text>
                </TouchableOpacity>
              )}

              {(vsState === VS.CONFIRM || vsState === VS.LEM_CONFIRM) && (
                <TouchableOpacity
                  onPress={() => handleVoiceInput('corrigir')}
                  style={{ flex:1, height:46, borderRadius:14, backgroundColor:T.blueGlow, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:T.blue+'30' }}>
                  <Text style={{ color:T.blue, fontWeight:'800', fontSize:13*fontScale }}>Corrigir</Text>
                </TouchableOpacity>
              )}
            </View>

          {/* ── Animação de sucesso (produto) ─────────────────────────────── */}
          {showSaveAnim && (
            <Animated.View style={{
              position:'absolute', top:0, left:0, right:0, bottom:0,
              borderRadius:36, backgroundColor:'rgba(4,18,11,0.97)',
              justifyContent:'center', alignItems:'center',
              opacity:sOpac, zIndex:999,
            }}>
              <Animated.View style={{ position:'absolute', width:180, height:180, borderRadius:90, borderWidth:2.5, borderColor:'#00D068', transform:[{scale:sRing1}], opacity:sRingO1 }} />
              <Animated.View style={{ position:'absolute', width:240, height:240, borderRadius:120, borderWidth:1.5, borderColor:'#00D06880', transform:[{scale:sRing2}], opacity:sRingO2 }} />
              <Animated.View style={{ width:138, height:138, borderRadius:69, backgroundColor:'#00D06820', borderWidth:3.5, borderColor:'#00D068', justifyContent:'center', alignItems:'center', transform:[{scale:sCircle}], shadowColor:'#00D068', shadowOpacity:1, shadowRadius:55, elevation:30 }}>
                <Animated.View style={{transform:[{scale:sCheck}]}}>
                  <Feather name="check" size={66} color="#00D068" />
                </Animated.View>
              </Animated.View>
              {[{top:-95,left:10},{top:-70,right:-55},{top:10,right:-100},{bottom:-80,right:-20},{bottom:-65,left:-60},{top:20,left:-100},{top:-85,left:-50},{bottom:-40,right:-80}].map((pos,i) => (
                <Animated.Text key={i} style={{ position:'absolute', fontSize:22,...pos, opacity:sPartO, transform:[{scale:sPartS}] }}>
                  {['⭐','✨','🌟','💫','⭐','✨','🌟','💫'][i]}
                </Animated.Text>
              ))}
              <Animated.Text style={{ fontSize:28, fontWeight:'900', color:'#FFF', marginTop:26, letterSpacing:-0.5, opacity:sTextO, transform:[{translateY:sTextY}] }}>
                Produto Salvo! 🎉
              </Animated.Text>
              <Animated.Text style={{ fontSize:14, color:'#00D068', fontWeight:'700', marginTop:8, opacity:sSubTextO }}>
                Cadastro realizado com sucesso
              </Animated.Text>
            </Animated.View>
          )}

          </Animated.View>
          )} {/* fim do else (modal padrão) */}
        </View>
      </>
    </Modal>
  );
};


const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, minHeight: 54 },
  btnTxt: { fontWeight: '800', letterSpacing: 0.3 },
});


// ─── DEEPGRAM CONFIG ─────────────────────────────────────────────────────────
const DEEPGRAM_API_KEY = '99ddf828d4529173c6396612133bc671247a3966';

// ─── ELEVEN LABS CONFIG — POOL DE 3 CHAVES COM PRIORIDADE E CACHE ──────────
// A chave que funcionou por último é salva no SafeStore e tentada PRIMEIRO
// Ordem padrão: KEY1 (original) → KEY2 (nova1) → KEY3 (nova2) → KEY_SECONDARY (Baserow)
// SEM fallback para Speech até esgotar TODAS as chaves ElevenLabs
const ELEVEN_LABS_API_KEY   = 'sk_5eeaa17369322e234f74a50aff06a52d6e6a2c5edb3878b9';
const ELEVEN_LABS_API_KEY2  = 'sk_e089d35e697bce9cfa17c90126ac8896660d541111309e23';
const ELEVEN_LABS_API_KEY3  = 'sk_893c09253973be0f43d5718c72d29e708acc890ee0a6f16e';
const ELEVEN_LABS_VOICE_ID  = 'pqHfZKP75CvOlQylNhV4'; // Bill — pt-BR nativo ElevenLabs
const EL_LAST_KEY_STORE     = 'GEI_EL_LastWorkingKey'; // chave da última chamada ok

// Pool de chaves em ordem de prioridade (chave do Baserow é adicionada em runtime)
const _getElevenLabsKeyPool = () => {
  const pool = [];
  if (ELEVEN_LABS_API_KEY  ) pool.push({ key: ELEVEN_LABS_API_KEY,   label: 'KEY1' });
  if (ELEVEN_LABS_API_KEY2 ) pool.push({ key: ELEVEN_LABS_API_KEY2,  label: 'KEY2' });
  if (ELEVEN_LABS_API_KEY3 ) pool.push({ key: ELEVEN_LABS_API_KEY3,  label: 'KEY3' });
  if (ELEVEN_LABS_API_KEY_SECONDARY?.trim()) pool.push({ key: ELEVEN_LABS_API_KEY_SECONDARY, label: 'Baserow' });
  return pool;
};

// Reordena o pool colocando a última chave que funcionou na frente (economia de tentativas)
const _sortPoolByLastWorking = async (pool) => {
  try {
    const last = await SafeStore.getItemAsync(EL_LAST_KEY_STORE);
    if (!last) return pool;
    const idx = pool.findIndex(p => p.key === last);
    if (idx <= 0) return pool; // já está na frente ou não encontrada
    const reordered = [pool[idx], ...pool.slice(0, idx), ...pool.slice(idx + 1)];
    return reordered;
  } catch { return pool; }
};

// ─── FUNÇÃO PARA BUSCAR COTAS DO ELEVEN LABS (verifica TODAS as chaves) ──────
const fetchElevenLabsQuota = async () => {
  const pool = _getElevenLabsKeyPool();
  for (const { key, label } of pool) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        method: 'GET', headers: { 'xi-api-key': key },
      });
      if (r.ok) {
        const d = await r.json();
        const remaining = (d.character_limit||0) - (d.character_count||0);
        return {
          key: label,
          characterCount: d.character_count || 0,
          characterLimit: d.character_limit || 0,
          remaining,
          percentUsed: d.character_limit ? ((d.character_count/d.character_limit)*100).toFixed(1) : 0,
        };
      }
    } catch { /* tenta próxima */ }
  }
  return null;
};

// ─── ECONOMIA DE TOKENS: trunca texto para não desperdiçar cota ──────────────
// Textos de lembrete/notificação costumam ser curtos — textos longos de IA são
// truncados inteligentemente (não no meio de uma palavra).
const _truncateForTTS = (text, maxChars = 280) => {
  if (!text || text.length <= maxChars) return text;
  // Tenta cortar em ponto final próximo do limite
  const cut = text.lastIndexOf('.', maxChars);
  if (cut > maxChars * 0.6) return text.slice(0, cut + 1);
  // Fallback: corta na última palavra antes do limite
  const cutSpace = text.lastIndexOf(' ', maxChars);
  return text.slice(0, cutSpace > 0 ? cutSpace : maxChars) + '…';
};

// ─── ELEVENLABS TTS — PRIORIDADE TOTAL, 3 CHAVES, ECONOMIA DE TOKENS ─────────
//
// ESTRATÉGIA:
//   1. Usa a chave que funcionou por último (cache no SafeStore) → 0 delay
//   2. Se falhar: tenta as demais em ordem, sem delay entre tentativas de quota
//   3. Erros de REDE (timeout/abort): 1 retry na mesma chave com 800ms de espera
//   4. Quota esgotada (402/429): pula imediatamente para próxima chave
//   5. Só vai para Speech nativo se TODAS as chaves ElevenLabs falharem
//
// ECONOMIA DE TOKENS:
//   - Textos > 280 chars são truncados antes de enviar
//   - Usa modelo "eleven_turbo_v2_5" (mais leve que multilingual v2, mesma voz)
//   - voice_settings mínimas necessárias para boa qualidade
//
// Web    → AudioContext.decodeAudioData (sem bloqueio de autoplay)
// Nativo → FileReader → data URI → expo-av
//
let _elCurrentSound = null;
let _elLastStatus   = { key:'none', attempts:0, lastError:'', ts:0 };
// Mutex simples: evita chamadas sobrepostas (ex: lembrete + resposta IA ao mesmo tempo)
let _elBusy         = false;
let _elQueue        = [];
// Getter: verdadeiro enquanto ElevenLabs está gerando/reproduzindo áudio
const isElevenLabsSpeaking = () => _elBusy;

// Fila de callbacks chamados quando ElevenLabs termina de falar
// O always-on se registra aqui em vez de fazer polling
let _elDoneCallbacks = [];
const onElevenLabsDone = (cb) => { _elDoneCallbacks.push(cb); };
const _fireElevenLabsDone = () => {
  const cbs = _elDoneCallbacks;
  _elDoneCallbacks = [];
  cbs.forEach(cb => { try { cb(); } catch { /* noop */ } });
}; // fila de textos pendentes

const _elPlayNext = async () => {
  if (_elBusy || _elQueue.length === 0) return;
  _elBusy = true;
  const { text, onDone } = _elQueue.shift();
  await _doSpeak(text, onDone);
  _elBusy = false;
  if (_elQueue.length > 0) {
    _elPlayNext(); // processa próximo da fila
  } else {
    // Fila vazia → avisa todos os ouvintes que o EL terminou
    _fireElevenLabsDone();
  }
};

// Callback registrado pelo always-on para parar o mic quando EL for falar
let _elMicStopCallback = null;
const registerMicStopForEL = (cb) => { _elMicStopCallback = cb; };

// ─── FLAG GLOBAL: JARVIS em processamento ────────────────────────────────────
// Quando true, bloqueia qualquer fala de "nao entendi" — evita spam durante análise
let _jarvisProcessing = false;
const setJarvisProcessingFlag = (v) => { _jarvisProcessing = v; };

// ─── BLOQUEADOR DE FRASES REPETITIVAS (cooldown 30s) ────────────────────────
// Evita que "Não entendi" e similares sejam faladas em loop contínuo.
// Chave = frase normalizada; valor = timestamp da última vez que foi falada.
const _spokenCooldownMap = new Map();
const _COOLDOWN_MS = 30_000; // 30 segundos
const _COOLDOWN_PHRASES = [
  /n[aã]o entend/i,
  /n[aã]o conseg/i,
  /n[aã]o ouv/i,
  /pode repetir/i,
  /repita por favor/i,
  /n[aã]o captei/i,
  /n[aã]o peguei/i,
  /desculpe, n[aã]o/i,
  /tente novamente/i,
  /nao entend/i,
];
const _isCooldownPhrase = (text) => _COOLDOWN_PHRASES.some(re => re.test(text));

const speakWithElevenLabs = (text, onDone) => {
  if (!text?.trim()) { if (onDone) setTimeout(onDone, 30); return; }

  // ── Cooldown: bloqueia frases de "não entendi" repetidas em < 30s ──────────
  if (_isCooldownPhrase(text)) {
    // Bloqueia completamente enquanto JARVIS processa
    if (_jarvisProcessing) {
      if (onDone) setTimeout(onDone, 30);
      return;
    }
    const key = text.trim().toLowerCase().slice(0, 60);
    const last = _spokenCooldownMap.get(key) || 0;
    const now  = Date.now();
    if (now - last < _COOLDOWN_MS) {
      // Ainda no cooldown — ignora a fala mas executa o callback para não travar o fluxo
      if (onDone) setTimeout(onDone, 30);
      return;
    }
    _spokenCooldownMap.set(key, now);
  }

  // Cancela qualquer fala nativa em curso
  try { Speech.stop(); } catch { /* noop */ }
  // PARA O MICROFONE ALWAYS-ON ANTES DE FALAR
  // Evita que o mic capture a voz do ElevenLabs e crie loop
  if (_elMicStopCallback) {
    try { _elMicStopCallback(); } catch { /* noop */ }
  }
  // Adiciona à fila (evita sobreposição)
  _elQueue.push({ text: _truncateForTTS(text), onDone });
  // Se limite da fila ultrapassar 3, descarta os mais antigos (exceto o primeiro)
  if (_elQueue.length > 3) _elQueue.splice(1, _elQueue.length - 2);
  _elPlayNext();
};

const _doSpeak = async (text, onDone) => {
  // Para som anterior
  if (_elCurrentSound) {
    try { await _elCurrentSound.stopAsync(); await _elCurrentSound.unloadAsync(); } catch { /* noop */ }
    _elCurrentSound = null;
  }

  // ── Fallback final: voz nativa do sistema ────────────────────────────────
  // Retorna Promise que resolve quando a fala terminar (necessário para _elBusy)
  const _fallback = (motivo) => new Promise(resolve => {
    console.warn(`[EL] Fallback voz do sistema. ${motivo}`);
    _elLastStatus = { key:'fallback', attempts:_elLastStatus.attempts, lastError:motivo, ts:Date.now() };
    const wrapped = () => { if (onDone) onDone(); resolve(); };
    try {
      Speech.speak(text, { language:'pt-BR', rate:1.0, pitch:1.0, onDone: wrapped, onError: wrapped });
    } catch { wrapped(); }
  });

  // ── Chamada HTTP à API ElevenLabs ────────────────────────────────────────
  const _call = async (apiKey, timeoutMs = 6000) => {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}?output_format=mp3_44100_64`,
        {
          method: 'POST',
          headers: { 'Accept':'audio/mpeg', 'Content-Type':'application/json', 'xi-api-key': apiKey },
          body: JSON.stringify({
            text,
            // eleven_multilingual_v2 suporta pt-BR nativo (turbo_v2_5 não aceita language_code)
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability:0.5, similarity_boost:0.82, use_speaker_boost:true },
          }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(tid);
      return res;
    } catch (e) { clearTimeout(tid); throw e; }
  };

  // ── Monta pool reordenado pela última chave que funcionou ────────────────
  const rawPool = _getElevenLabsKeyPool();
  const pool    = await _sortPoolByLastWorking(rawPool);
  let response  = null;
  let attempts  = 0;

  for (const { key, label } of pool) {
    attempts++;
    _elLastStatus.attempts = attempts;
    try {
      console.log(`[EL] Tentativa ${attempts}/${pool.length}: ${label} (${key.slice(0,10)}…)`);
      response = await _call(key);

      if (response.ok) {
        // ✅ Sucesso — salva esta chave como a "última que funcionou"
        console.log(`[EL] ✅ ${label} OK (tentativa ${attempts})`);
        _elLastStatus = { key:label, attempts, lastError:'', ts:Date.now() };
        try { await SafeStore.setItemAsync(EL_LAST_KEY_STORE, key); } catch { /* noop */ }
        break; // para de tentar
      }

      // Lê corpo do erro para diagnóstico
      let errMsg = `HTTP ${response.status}`;
      try {
        const j = await response.clone().json();
        errMsg = j?.detail?.message || j?.detail?.status || j?.detail || errMsg;
      } catch { /* noop */ }
      console.warn(`[EL] ${label} FALHOU: ${errMsg}`);
      _elLastStatus.lastError = `${label}: ${errMsg}`;

      // Quota esgotada (402) ou rate limit (429) → pula imediatamente, sem delay
      if (response.status === 402 || response.status === 429) {
        console.warn(`[EL] ${label} sem quota/rate-limit — próxima chave imediatamente`);
        response = null;
        continue;
      }
      // Erro de auth (401/403) → chave inválida, pula
      if (response.status === 401 || response.status === 403) {
        console.warn(`[EL] ${label} autenticação falhou — próxima chave`);
        response = null;
        continue;
      }
      // Outros erros do servidor (5xx) → pequena espera antes da próxima
      if (response.status >= 500) {
        await new Promise(r => setTimeout(r, 150));
      }
      response = null;

    } catch (netErr) {
      // Erro de rede/timeout → 1 retry na mesma chave após 800ms (pode ser instabilidade)
      console.warn(`[EL] ${label} erro de rede: ${netErr?.message} — retry em 300ms`);
      await new Promise(r => setTimeout(r, 300));
      try {
        response = await _call(key, 8000); // timeout maior no retry
        if (response.ok) {
          console.log(`[EL] ✅ ${label} OK no retry (tentativa ${attempts})`);
          _elLastStatus = { key:`${label}(retry)`, attempts, lastError:'', ts:Date.now() };
          try { await SafeStore.setItemAsync(EL_LAST_KEY_STORE, key); } catch { /* noop */ }
          break;
        }
        console.warn(`[EL] ${label} retry também falhou: HTTP ${response.status}`);
        response = null;
      } catch (retryErr) {
        console.warn(`[EL] ${label} retry de rede falhou: ${retryErr?.message}`);
        response = null;
      }
    }
  }

  // ── Todas as chaves falharam → fallback para voz nativa ──────────────────
  if (!response?.ok) {
    await _fallback(`Todas as ${attempts} tentativas ElevenLabs falharam. Último: ${_elLastStatus.lastError}`);
    return;
  }

  // ── Reproduz o áudio recebido ─────────────────────────────────────────────
  try {
    const blob = await response.blob();

    // WEB: AudioContext (desbloqueado pelo microfone)
    if (Platform.OS === 'web') {
      try {
        const ctx = _getWebAudioCtx();
        if (!ctx) throw new Error('AudioContext indisponível');
        if (ctx.state === 'suspended') await ctx.resume();
        const arrayBuf    = await blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);
        const source      = ctx.createBufferSource();
        source.buffer     = audioBuffer;
        source.connect(ctx.destination);
        source.onended    = () => { if (onDone) onDone(); };
        source.start(0);
      } catch (webErr) {
        console.error(`[EL][Web] AudioContext erro: ${webErr?.message}`);
        await _fallback(`AudioContext: ${webErr?.message}`);
      }
      return;
    }

    // NATIVO: salva MP3 em arquivo temporário → expo-av
    // FileReader não existe no React Native — usamos expo-file-system
    let audioUri = null;
    try {
      const FileSystem = require('expo-file-system');
      const arrayBuf = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuf);
      // Converte para base64 sem FileReader
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const tmpPath = FileSystem.cacheDirectory + `el_tts_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tmpPath, base64, { encoding: FileSystem.EncodingType.Base64 });
      audioUri = tmpPath;
    } catch (fsErr) {
      console.warn(`[EL] expo-file-system falhou: ${fsErr?.message} — tentando data URI`);
      // Fallback: tenta FileReader (funciona em alguns ambientes)
      audioUri = await new Promise(resolve => {
        try {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror   = () => resolve('');
          reader.readAsDataURL(blob);
        } catch { resolve(''); }
      });
    }

    if (!audioUri) throw new Error('Não foi possível obter URI do áudio');

    // Garante modo de reprodução (desativa gravação no iOS para não conflitar com mic)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:      false,
        playsInSilentModeIOS:    true,
        staysActiveInBackground: false,
        interruptionModeIOS:     1, // DO_NOT_MIX — interrompe outras sessões de áudio
        interruptionModeAndroid: 1,
        shouldDuckAndroid:       false,
        playThroughEarpieceAndroid: false,
      });
    } catch { /* noop */ }
    // _doSpeak retorna APENAS quando o áudio termina de tocar
    // garantindo que _elBusy=true durante toda a reprodução
    await new Promise(async (resolveAudio) => {
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        clearTimeout(safetyTimer);
        if (_elCurrentSound === sound) _elCurrentSound = null;
        try { await sound.unloadAsync(); } catch { /* noop */ }
        try {
          const FileSystem = require('expo-file-system');
          if (audioUri?.startsWith(FileSystem.cacheDirectory)) await FileSystem.deleteAsync(audioUri, { idempotent: true });
        } catch { /* noop */ }
        if (onDone) onDone();
        resolveAudio();
      };
      const { sound } = await Audio.Sound.createAsync({ uri: audioUri }, { shouldPlay: true });
      _elCurrentSound = sound;
      // Segurança: resolve após 90s mesmo sem evento (áudio muito longo ou bug)
      const safetyTimer = setTimeout(() => finish(), 90000);
      sound.setOnPlaybackStatusUpdate(async status => {
        if (status.didJustFinish || (status.isLoaded === false && _elCurrentSound === sound)) {
          await finish();
        }
      });
    });

  } catch (audioErr) {
    console.error(`[EL] Erro ao reproduzir blob: ${audioErr?.message}`);
    await _fallback(`Áudio: ${audioErr?.message}`);
  }
};

// Alias de compatibilidade
const speakWithAI = speakWithElevenLabs;

// ─── WEB AUDIOCONTEXT — unlock automático no primeiro uso de microfone ────────
// Chrome bloqueia audio.play() até que haja interação humana. O microfone
// (Speech Recognition) conta como interação — ao liberar, desbloqueamos o ctx.
let _webAudioCtx = null;
const _getWebAudioCtx = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (!_webAudioCtx) {
    try { _webAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* noop */ }
  }
  return _webAudioCtx;
};
const _unlockWebAudio = () => {
  try {
    const ctx = _getWebAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* noop */ }
};

// --- SOM audior.mp3: toca quando reconhecimento ativa (so dentro do VoiceAssistant) ---
// Agora com controle de volume e vibração
let _audioRSound = null;
// ─── REFS GLOBAIS: configurações de som/vibração do microfone ────────────────
// Atualizadas pelo App principal via setGlobalMicSettings()
let _globalMicSoundEnabled = true;
let _globalMicVibrationEnabled = true;
let _globalMicSoundVolume = 1.0;
const setGlobalMicSettings = (soundEnabled, vibrationEnabled, volume) => {
  _globalMicSoundEnabled    = soundEnabled;
  _globalMicVibrationEnabled = vibrationEnabled;
  _globalMicSoundVolume      = volume;
};

const playAudioR = async (volume = 0.9, vibrate = true) => {
  try {
    if (_audioRSound) {
      try { await _audioRSound.stopAsync(); await _audioRSound.unloadAsync(); } catch { /* noop */ }
      _audioRSound = null;
    }
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch { /* noop */ }
    const { sound } = await Audio.Sound.createAsync(
      require('./assets/audior.mp3'),
      { shouldPlay: true, volume: Math.max(0, Math.min(1, volume)) } // Garante volume entre 0 e 1
    );
    _audioRSound = sound;
    sound.setOnPlaybackStatusUpdate(async (status) => {
      if (status.didJustFinish) {
        try { await sound.unloadAsync(); } catch { /* noop */ }
        if (_audioRSound === sound) _audioRSound = null;
      }
    });
    
    // ── Vibração: tenta expo-haptics primeiro, fallback para Vibration ──────
    if (vibrate) {
      try {
        // Haptics funciona sem permissão no Android 13+ e iOS
        const Haptics = require('expo-haptics');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        try { Vibration.vibrate(100); } catch { /* noop */ }
      }
    }
  } catch (e) { console.warn("[playAudioR] Falha ao tocar audior.mp3:", e?.message || e); }
};

// ─── SOM DE ATIVAÇÃO / ESCUTA ─────────────────────────────────────────────────
// Toca um "bip" de ativação quando o wake word é detectado.
// Web  → Web Audio API (oscilador, zero dependências)
// Nativo → vibração suave + Speech curto silencioso
const playListenBeep = () => {
  // ── Respeita as configurações de som e vibração do microfone ──────────────
  // Se tanto som quanto vibração estão desabilitados, não faz nada.
  const soundOn     = _globalMicSoundEnabled;
  const vibrationOn = _globalMicVibrationEnabled;
  if (!soundOn && !vibrationOn) return;

  try {
    if (Platform.OS === 'web') {
      // Web: só toca se som estiver habilitado
      if (!soundOn) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(0, ctx.currentTime);

      // Tom ascendente duplo — sensação de "ativação"
      const tones = [
        { freq: 660, start: 0,    dur: 0.10, vol: 0.22 },
        { freq: 990, start: 0.12, dur: 0.14, vol: 0.28 },
      ];
      tones.forEach(({ freq, start, dur, vol }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.01);
      });
      setTimeout(() => { try { ctx.close(); } catch { /* noop */ } }, 600);
    } else {
      // Nativo: som tem prioridade; se desabilitado, tenta vibração como fallback
      if (soundOn) {
        // Reproduz via playAudioR usando as configurações globais (inclui vibração interna)
        playAudioR(_globalMicSoundVolume, vibrationOn);
      } else if (vibrationOn) {
        try { Vibration.vibrate([40, 30, 60]); } catch { /* noop */ }
      }
    }
  } catch { /* nunca trava o app */ }
};

// ─── [BLOCO LEGADO REMOVIDO] — speakWithElevenLabs real está definida acima ───
// Função vazia, nunca chamada, mantida apenas para não quebrar referências internas.
const _legacyNoop = async (_text, _onDone) => { /* removido */ }; // INÍCIO BLOCO LEGADO DELETADO
// ─── VOICE MODALS ────────────────────────────────────────────────────────────
const VoicePermissionModal = ({ visible, onAccept, onClose, T, fontScale }) => {
  const slideA = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  useEffect(() => {
    if (visible) Animated.spring(slideA, { toValue: 0, tension: 50, friction: 10, useNativeDriver: true }).start();
    else Animated.timing(slideA, { toValue: Dimensions.get('window').height, duration: 300, useNativeDriver: true }).start();
  }, [visible, slideA]);
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <Animated.View style={{ backgroundColor: T.bgCard, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 30, transform: [{ translateY: slideA }] }}>
          <View style={{ width: 60, height: 6, backgroundColor: T.border, borderRadius: 3, alignSelf: 'center', marginBottom: 25 }} />
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 20 }}>
            <Feather name="mic" size={40} color={T.blue} />
          </View>
          <Text style={{ fontSize: 24 * fontScale, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 10 }}>Comandos de Voz</Text>
          <Text style={{ fontSize: 16 * fontScale, color: T.textSub, textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>Ative o microfone para controlar o GEI.AI apenas com a sua voz.</Text>
          <TouchableOpacity onPress={onAccept} style={{ backgroundColor: T.blue, paddingVertical: 18, borderRadius: 20, alignItems: 'center', marginBottom: 12 }}><Text style={{ color: '#FFF', fontSize: 18 * fontScale, fontWeight: '800' }}>Ativar Agora</Text></TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 15, alignItems: 'center' }}><Text style={{ color: T.textMuted, fontSize: 15 * fontScale, fontWeight: '600' }}>Talvez depois</Text></TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};


const requestCameraPermission = async () => {
  try {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.error('❌ Erro ao solicitar permissão de câmera:', err);
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK: useAlwaysOnWakeWord — VERSÃO REESCRITA COM PROTEÇÃO TOTAL AO BUG DE MIC
//
// ██ PROBLEMA RAIZ: o bug de "desativar rapidamente" ocorre porque:
//    1. enabled muda para false antes do stop() nativo terminar
//    2. o evento 'end' chega DEPOIS do cleanup → _safeRestart dispara mesmo desativado
//    3. múltiplos start() simultâneos quando há race condition de enable/disable rápido
//    4. Eventos de outra sessão de mic (VoiceAssistant) disparam callbacks do wake-word
//
// ██ SOLUÇÕES IMPLEMENTADAS:
//    • sessionIdRef  — cada sessão de escuta tem um ID único. Eventos de sessões
//                      antigas são silenciosamente descartados (geração por token).
//    • mountedRef    — se o componente desmontou, NUNCA recria timers.
//    • stopInFlight  — flag que bloqueia restart enquanto stop() ainda não retornou.
//    • MIN_STOP_GAP  — cooldown mínimo de 800ms entre stop e próximo start.
//    • disableSeq    — número de sequência de disable: se changed novamente antes
//                      do stop ser chamado, a versão anterior é ignorada.
//    • Watchdog mais inteligente: só reinicia se a sessão realmente morreu
//      (sessionId não mudou em 15s E enabled ainda é true).
//    • enabledRef tem double-check antes de qualquer async await.
// ═══════════════════════════════════════════════════════════════════════════════

// Wrapper seguro para useSpeechRecognitionEvent (pode ser null em Expo Go)
const _useSpeechEventSafe = _useSpeechRecognitionEventReal ||
  ((eventName, handler) => { useEffect(() => {}, [eventName]); });

const MIN_STOP_GAP    = 800;   // ms mínimo entre stop e próximo start
const MAX_FAIL_DELAY  = 9000;  // ms máximo de backoff
const WATCHDOG_MS     = 14000; // ms entre verificações do watchdog

const useAlwaysOnWakeWord = ({ enabled, onWakeWord, onNovidadesWord, onLembreteWord, onCalculadoraWord, onJarvisWord }) => {
  const [isAlwaysListening, setIsAlwaysListening] = useState(false);

  // ── Refs de controle ──────────────────────────────────────────────────────
  const enabledRef       = useRef(false);
  const onWakeRef        = useRef(onWakeWord);
  const onNovidadesRef   = useRef(onNovidadesWord);
  const onLembreteRef    = useRef(onLembreteWord);
  const onCalculadoraRef = useRef(onCalculadoraWord);
  const onJarvisRef      = useRef(onJarvisWord);
  const webRecRef        = useRef(null);
  const restartTimerRef  = useRef(null);
  const watchdogRef      = useRef(null);
  const mountedRef       = useRef(true);

  // Anti-bug: controle de sessão por ID único
  const sessionIdRef     = useRef(0);   // incrementa a cada start() nativo
  const activeSessionRef = useRef(0);   // ID da sessão que atualmente "ouve"
  const stopInFlight     = useRef(false); // true: stop() foi chamado mas 'end' ainda não chegou
  const lastStopTimeRef  = useRef(0);   // timestamp do último stop
  const isStartingRef    = useRef(false);
  const didFireRef       = useRef(false);
  const failCountRef     = useRef(0);
  const disableSeqRef    = useRef(0);   // sequência de disable — descarta ops antigas

  onWakeRef.current      = onWakeWord;
  onNovidadesRef.current = onNovidadesWord;
  onLembreteRef.current  = onLembreteWord;
  onCalculadoraRef.current = onCalculadoraWord;
  onJarvisRef.current    = onJarvisWord;

  // ── Limpa todos os timers ────────────────────────────────────────────────
  const _clearTimers = useCallback(() => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (watchdogRef.current)     { clearInterval(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  // ── Para o reconhecimento nativo com todas as proteções ──────────────────
  const _stopNative = useCallback(() => {
    if (stopInFlight.current) return; // já está parando
    stopInFlight.current = true;
    activeSessionRef.current = 0; // invalida sessão atual
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
    // Garante que stopInFlight é resetado mesmo se 'end' não chegar
    setTimeout(() => {
      stopInFlight.current = false;
      lastStopTimeRef.current = Date.now();
    }, 600);
  }, []);

  // ── Agendador seguro com proteção completa ───────────────────────────────
  // Registra callback de parada imediata do mic para o ElevenLabs
  // Isso para o mic ANTES do EL falar, evitando loop
  useEffect(() => {
    const stopFn = () => {
      if (!mountedRef.current) return;
      // Para o mic imediatamente e agenda restart após EL terminar
      _clearTimers();
      isStartingRef.current    = false;
      activeSessionRef.current = 0;
      stopInFlight.current     = true;
      if (Platform.OS !== 'web' && SPEECH_RECOGNITION_AVAILABLE) {
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
        lastStopTimeRef.current = Date.now();
      } else if (Platform.OS === 'web' && webRecRef.current) {
        try { webRecRef.current.abort(); } catch { /* noop */ }
        webRecRef.current = null;
      }
      stopInFlight.current = false;
      if (mountedRef.current) setIsAlwaysListening(false);
      // Registra callback para religar mic quando EL terminar
      onElevenLabsDone(() => {
        if (mountedRef.current && enabledRef.current && !didFireRef.current) {
          _safeRestart(350);
        }
      });
    };
    registerMicStopForEL(stopFn);
    return () => { registerMicStopForEL(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const _safeRestart = useCallback((delayMs) => {
    if (!mountedRef.current) return;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (!enabledRef.current) return;

    restartTimerRef.current = setTimeout(async () => {
      restartTimerRef.current = null;
      if (!mountedRef.current || !enabledRef.current || isStartingRef.current || didFireRef.current || stopInFlight.current) return;

      // Cooldown: garante gap mínimo desde o último stop
      const elapsed = Date.now() - lastStopTimeRef.current;
      if (elapsed < MIN_STOP_GAP) {
        _safeRestart(MIN_STOP_GAP - elapsed + 50);
        return;
      }

      const mySession = ++sessionIdRef.current;
      activeSessionRef.current = mySession;
      isStartingRef.current = true;

      // Aguarda ElevenLabs terminar antes de ligar o microfone
      // USA CALLBACK — não polling — para não criar loop de timeouts
      if (isElevenLabsSpeaking()) {
        isStartingRef.current = false;
        activeSessionRef.current = 0;
        // Registra callback único: quando EL terminar, tenta iniciar o mic
        onElevenLabsDone(() => {
          if (mountedRef.current && enabledRef.current && !didFireRef.current) {
            _safeRestart(300); // 300ms após EL terminar → liga mic
          }
        });
        return;
      }

      try {
        // Seta modo de gravação antes de iniciar o mic (necessário no iOS)
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS:      true,
            playsInSilentModeIOS:    true,
            staysActiveInBackground: false,
            interruptionModeIOS:     1,
            interruptionModeAndroid: 1,
          });
        } catch { /* noop */ }
        await ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: true, continuous: false });
        if (!mountedRef.current || !enabledRef.current || activeSessionRef.current !== mySession) {
          // Condição mudou enquanto aguardávamos — para imediatamente
          isStartingRef.current = false;
          _stopNative();
          return;
        }
        failCountRef.current = 0;
        isStartingRef.current = false;
        if (mountedRef.current) setIsAlwaysListening(true);
      } catch (e) {
        isStartingRef.current = false;
        activeSessionRef.current = 0;
        if (!mountedRef.current || !enabledRef.current) return;
        failCountRef.current = Math.min(failCountRef.current + 1, 10);
        const backoff = Math.min(800 + failCountRef.current * 700, MAX_FAIL_DELAY);
        console.warn(`[MIC] Falha ao iniciar (tentativa ${failCountRef.current}), retry em ${backoff}ms: ${e?.message}`);
        _safeRestart(backoff);
      }
    }, delayMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_clearTimers, _stopNative]);

  // ── Dispatch de wake-word (evita código duplicado) ───────────────────────
  const _dispatchWakeWord = useCallback((type) => {
    didFireRef.current    = true;
    isStartingRef.current = false;
    activeSessionRef.current = 0;
    _clearTimers();
    _stopNative();
    if (mountedRef.current) setIsAlwaysListening(false);
    playListenBeep();
    if (type === 'novidades') {
      // Abre o painel de novidades diretamente sem perguntar nada
      onNovidadesRef.current?.();
    }
    else if (type === 'lembrete') onLembreteRef.current?.();
    else if (type === 'calculadora') onCalculadoraRef.current?.();
    else if (type === 'jarvis') onJarvisRef.current?.();
    else                      onWakeRef.current?.();
  }, [_clearTimers, _stopNative]);

  // ── Resultado do reconhecimento nativo ──────────────────────────────────
  _useSpeechEventSafe('result', (event) => {
    if (!enabledRef.current || didFireRef.current) return;
    // Descartar eventos de sessões antigas (proteção principal contra bug de desativação rápida)
    const sessionNow = activeSessionRef.current;
    if (sessionNow === 0) return;
    const text = event?.results?.[0]?.transcript || '';
    if (detectCalculadoraCmd(text)) { _dispatchWakeWord('calculadora'); return; }
    if (detectLembreteCmd(text))  { _dispatchWakeWord('lembrete'); return; }
    if (detectNovidades(text))    { _dispatchWakeWord('novidades'); return; }
    if (detectJarvisWakeWord(text)) { _dispatchWakeWord('jarvis'); return; }
    if (detectWakeWord(text))     { _dispatchWakeWord('wake'); return; }
  });

  // ── Fim do reconhecimento nativo ────────────────────────────────────────
  _useSpeechEventSafe('end', (event) => {
    if (Platform.OS === 'web') return;
    const endedSession = activeSessionRef.current;
    stopInFlight.current  = false;
    lastStopTimeRef.current = Date.now();
    isStartingRef.current = false;
    if (mountedRef.current) setIsAlwaysListening(false);
    activeSessionRef.current = 0; // invalida sessão terminada

    if (!enabledRef.current || !mountedRef.current || didFireRef.current) return;
    if (endedSession === 0) return; // evento de sessão já inválida

    // Backoff exponencial: mais rápido em sucesso, mais lento em falhas
    const delay = Math.min(600 + failCountRef.current * 400, MAX_FAIL_DELAY);
    _safeRestart(delay);
  });

  // ── Erro do reconhecimento nativo ────────────────────────────────────────
  _useSpeechEventSafe('error', (event) => {
    if (Platform.OS === 'web') return;
    const errCode = event?.error || event?.message || 'unknown';
    console.warn(`[MIC] Erro nativo: ${errCode}`);
    stopInFlight.current  = false;
    lastStopTimeRef.current = Date.now();
    isStartingRef.current = false;
    activeSessionRef.current = 0;
    if (mountedRef.current) setIsAlwaysListening(false);
    if (!enabledRef.current || !mountedRef.current || didFireRef.current) return;
    // Erros fatais (permissão negada): não tenta novamente
    if (errCode === 'not-allowed' || errCode === 'service-not-allowed' || errCode === 'permission') return;
    failCountRef.current = Math.min(failCountRef.current + 1, 10);
    const delay = Math.min(1200 + failCountRef.current * 800, MAX_FAIL_DELAY);
    _safeRestart(delay);
  });

  // ── Web Speech API (Chrome) ────────────────────────────────────────────
  const startWebSpeech = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (!mountedRef.current || !enabledRef.current) return;
    try {
      const SpeechRec = typeof window !== 'undefined' &&
        (window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!SpeechRec) return;

      // Mata sessão anterior
      if (webRecRef.current) {
        try { webRecRef.current.onend = null; webRecRef.current.onerror = null; webRecRef.current.onresult = null; webRecRef.current.abort(); } catch { /* noop */ }
        webRecRef.current = null;
      }

      const mySession = ++sessionIdRef.current;
      const rec = new SpeechRec();
      rec.lang = 'pt-BR';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        if (!mountedRef.current || activeSessionRef.current !== mySession) {
          // Sessão inválida — aborta imediatamente
          try { rec.abort(); } catch { /* noop */ }
          return;
        }
        if (mountedRef.current) setIsAlwaysListening(true);
        _unlockWebAudio();
      };

      rec.onend = () => {
        if (webRecRef.current === rec) { webRecRef.current = null; }
        if (mountedRef.current) setIsAlwaysListening(false);
        if (!enabledRef.current || !mountedRef.current || activeSessionRef.current !== mySession) return;
        // Desativa sessão e reagenda
        activeSessionRef.current = 0;
        if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (enabledRef.current && mountedRef.current && !didFireRef.current) startWebSpeech();
        }, 700);
      };

      rec.onerror = (e) => {
        if (webRecRef.current === rec) { webRecRef.current = null; }
        if (mountedRef.current) setIsAlwaysListening(false);
        activeSessionRef.current = 0;
        const fatal = e.error === 'not-allowed' || e.error === 'service-not-allowed';
        if (fatal || !enabledRef.current || !mountedRef.current || didFireRef.current) return;
        const delay = (e.error === 'network' || e.error === 'audio-capture') ? 3500 : 1000;
        if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (enabledRef.current && mountedRef.current && !didFireRef.current) startWebSpeech();
        }, delay);
      };

      rec.onresult = (event) => {
        if (!enabledRef.current || didFireRef.current || activeSessionRef.current !== mySession) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i]?.[0]?.transcript || '';
          if (detectCalculadoraCmd(text)) { _dispatchWakeWord("calculadora"); return; }
          if (detectLembreteCmd(text)) {
            activeSessionRef.current = 0;
            didFireRef.current = true;
            try { rec.onend = null; rec.abort(); } catch { /* noop */ }
            webRecRef.current = null;
            if (mountedRef.current) setIsAlwaysListening(false);
            playListenBeep();
            onLembreteRef.current?.();
            return;
          }
          if (detectNovidades(text)) {
            activeSessionRef.current = 0;
            didFireRef.current = true;
            try { rec.onend = null; rec.abort(); } catch { /* noop */ }
            webRecRef.current = null;
            if (mountedRef.current) setIsAlwaysListening(false);
            playListenBeep();
            onNovidadesRef.current?.();
            return;
          }
          if (detectJarvisWakeWord(text)) {
            activeSessionRef.current = 0;
            didFireRef.current = true;
            try { rec.onend = null; rec.abort(); } catch { /* noop */ }
            webRecRef.current = null;
            if (mountedRef.current) setIsAlwaysListening(false);
            playListenBeep();
            onJarvisRef.current?.();
            return;
          }
          if (detectWakeWord(text)) {
            activeSessionRef.current = 0;
            didFireRef.current = true;
            try { rec.onend = null; rec.abort(); } catch { /* noop */ }
            webRecRef.current = null;
            if (mountedRef.current) setIsAlwaysListening(false);
            playListenBeep();
            onWakeRef.current?.();
            return;
          }
        }
      };

      activeSessionRef.current = mySession;
      webRecRef.current = rec;
      rec.start();
    } catch (e) {
      console.warn('[MIC][Web] startWebSpeech falhou:', e?.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Watchdog: reinicia se a sessão morreu silenciosamente ────────────────
  const _restartAll = useCallback(() => {
    if (!enabledRef.current || !mountedRef.current || didFireRef.current) return;
    if (Platform.OS === 'web') {
      if (webRecRef.current === null && !restartTimerRef.current) {
        if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (enabledRef.current && mountedRef.current) startWebSpeech();
        }, 400);
      }
    } else if (SPEECH_RECOGNITION_AVAILABLE) {
      const noSession  = activeSessionRef.current === 0;
      const noStarting = !isStartingRef.current;
      const noTimer    = !restartTimerRef.current;
      const noStop     = !stopInFlight.current;
      if (noSession && noStarting && noTimer && noStop) {
        if (isElevenLabsSpeaking()) {
          // Watchdog aguarda via callback em vez de re-verificar no próximo tick
          onElevenLabsDone(() => {
            if (mountedRef.current && enabledRef.current && !didFireRef.current) {
              _safeRestart(300);
            }
          });
        } else {
          _safeRestart(800);
        }
      }
    }
  }, [startWebSpeech, _safeRestart]);

  // ── Lifecycle: liga/desliga ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const myDisableSeq = ++disableSeqRef.current;

    enabledRef.current    = enabled;
    didFireRef.current    = false;
    failCountRef.current  = 0;
    _clearTimers();

    if (!enabled) {
      // ── DESATIVAR ─────────────────────────────────────────────────────────
      isStartingRef.current    = false;
      activeSessionRef.current = 0;
      stopInFlight.current     = false;
      if (mountedRef.current) setIsAlwaysListening(false);

      if (Platform.OS === 'web' && webRecRef.current) {
        try { webRecRef.current.onend = null; webRecRef.current.onerror = null; webRecRef.current.onresult = null; webRecRef.current.abort(); } catch { /* noop */ }
        webRecRef.current = null;
      }
      if (Platform.OS !== 'web' && SPEECH_RECOGNITION_AVAILABLE) {
        // Para com delay mínimo para evitar bug de "stop imediato após start"
        const stopSeq = myDisableSeq;
        setTimeout(() => {
          if (disableSeqRef.current !== stopSeq) return; // enabled mudou de novo
          try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
          lastStopTimeRef.current = Date.now();
        }, 80);
      }
      return;
    }

    // ── ATIVAR ───────────────────────────────────────────────────────────────
    if (Platform.OS === 'web') {
      setTimeout(() => {
        if (!enabledRef.current || !mountedRef.current) return;
        startWebSpeech();
      }, 200);
    } else if (SPEECH_RECOGNITION_AVAILABLE) {
      (async () => {
        try {
          // Solicitar permissão apenas em nativo (requestPermissionsAsync não suporta web)
          if (Platform.OS !== 'web') {
            const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            if (!granted || !enabledRef.current || !mountedRef.current) return;
          }
          _safeRestart(250);
        } catch { /* noop */ }
      })();
    }

    // Watchdog: verifica saúde a cada WATCHDOG_MS
    watchdogRef.current = setInterval(() => {
      _restartAll();
    }, WATCHDOG_MS);

    return () => {
      enabledRef.current       = false;
      isStartingRef.current    = false;
      activeSessionRef.current = 0;
      _clearTimers();
      // NÃO seta mountedRef = false aqui (isso é feito no cleanup final abaixo)
    };
  }, [enabled, startWebSpeech, _restartAll, _safeRestart, _clearTimers]);

  // Cleanup de desmontagem (separado para garantir ordem)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      enabledRef.current = false;
      _clearTimers();
      if (Platform.OS === 'web' && webRecRef.current) {
        try { webRecRef.current.onend = null; webRecRef.current.abort(); } catch { /* noop */ }
        webRecRef.current = null;
      }
      if (Platform.OS !== 'web' && SPEECH_RECOGNITION_AVAILABLE) {
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isAlwaysListening };
};

// ─── INDICADOR FLUTUANTE "SEMPRE OUVINDO" ─────────────────────────────────────
// Aparece no canto inferior esquerdo quando o usuário está logado.
// Toque nele para abrir o assistente de voz diretamente.
const AlwaysOnIndicator = ({ isListening, T, TAB_SAFE, onPress, onBellPress, onHide, visible }) => {
  const pulseA = useRef(new Animated.Value(1)).current;
  const dotA   = useRef(new Animated.Value(0.4)).current;
  const loopRef = useRef(null);

  useEffect(() => {
    if (loopRef.current) { loopRef.current.stop(); loopRef.current = null; }
    if (isListening) {
      loopRef.current = Animated.loop(Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseA, { toValue: 1.22, duration: 700, useNativeDriver: false }),
          Animated.timing(pulseA, { toValue: 1,    duration: 700, useNativeDriver: false }),
        ]),
        Animated.sequence([
          Animated.timing(dotA, { toValue: 1,   duration: 500, useNativeDriver: false }),
          Animated.timing(dotA, { toValue: 0.3, duration: 500, useNativeDriver: false }),
        ]),
      ]));
      loopRef.current.start();
    } else {
      Animated.timing(pulseA, { toValue: 1,   duration: 200, useNativeDriver: false }).start();
      Animated.timing(dotA,   { toValue: 0.4, duration: 200, useNativeDriver: false }).start();
    }
    return () => { if (loopRef.current) { loopRef.current.stop(); loopRef.current = null; } };
  }, [isListening, pulseA, dotA]);

  if (visible === false) return null;

  return (
    <View style={{ position:'absolute', bottom: TAB_SAFE + 16, left: 16, zIndex: 9990, flexDirection:'row', alignItems:'center', gap: 8 }}>
      {/* ── Pill principal: microfone ── */}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.82}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: isListening ? T.blue : T.bgCard,
          borderRadius: 50,
          paddingHorizontal: 13,
          paddingVertical: 8,
          borderWidth: 1.5,
          borderColor: isListening ? T.blue + '70' : T.border,
          shadowColor: T.blue,
          shadowOpacity: isListening ? 0.45 : 0.08,
          shadowRadius: 10,
          elevation: isListening ? 8 : 2,
        }}
      >
        <Animated.View style={{ transform: [{ scale: pulseA }] }}>
          <MaterialCommunityIcons
            name={isListening ? 'microphone' : 'microphone-off'}
            size={15}
            color={isListening ? '#FFF' : T.textMuted}
          />
        </Animated.View>
        <Animated.View style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: isListening ? '#FFF' : T.textMuted,
          opacity: dotA,
        }} />
        <Text style={{ fontSize: 11, fontWeight: '900', color: isListening ? '#FFF' : T.textMuted, letterSpacing: 0.4 }}>
          {isListening ? 'Ouvindo...' : 'Voz'}
        </Text>
        {onHide && (
          <TouchableOpacity
            onPress={(e) => { if (e && e.stopPropagation) e.stopPropagation(); onHide(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginLeft: 3, opacity: 0.75 }}
          >
            <Feather name="x" size={11} color={isListening ? '#FFF' : T.textMuted} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* ── Botão sino: abre notificações agendadas ── */}
      {onBellPress && (
        <TouchableOpacity
          onPress={onBellPress}
          activeOpacity={0.82}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: T.bgCard,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 1.5, borderColor: '#F59E0B50',
            shadowColor: '#F59E0B', shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
          }}
        >
          <MaterialCommunityIcons name="bell-badge" size={17} color="#F59E0B" />
        </TouchableOpacity>
      )}
    </View>
  );
};


// ─── COMPONENTE DE PERMISSÃO DE NOTIFICAÇÃO — REDESIGN AI ────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: NOTIFICAÇÕES AGENDADAS
// Lista todos os lembretes ativos com countdown, status e opção de cancelar
// ═══════════════════════════════════════════════════════════════════════════════
const ScheduledNotifsModal = ({ visible, onClose, T, fontScale }) => {
  const slideA  = useRef(new Animated.Value(40)).current;
  const opacA   = useRef(new Animated.Value(0)).current;
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow]         = useState(new Date());
  const tickRef = useRef(null);

  // Formata duração restante em texto legível
  const formatCountdown = (triggerDate) => {
    const diff = triggerDate - now;
    if (diff <= 0) return { text: 'Passou', color: T.red, emoji: '⚠️' };
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days  = Math.floor(hours / 24);
    if (days > 0)  return { text: `em ${days}d ${hours % 24}h`, color: T.amber, emoji: days <= 3 ? '🔶' : '🔔' };
    if (hours > 0) return { text: `em ${hours}h ${mins % 60}min`, color: T.blue, emoji: '⏰' };
    if (mins > 0)  return { text: `em ${mins} min`, color: T.green, emoji: '⚡' };
    return { text: 'Agora!', color: T.green, emoji: '🔔' };
  };

  const loadNotifs = async () => {
    setLoading(true);
    try {
      // Busca notificações agendadas no sistema
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      // Busca lembretes salvos localmente para cruzar dados
      const lembretes = await getLembretes();
      const lemMap = {};
      lembretes.forEach(l => { if (l.notifId) lemMap[l.notifId] = l; });

      const parsed = scheduled.map(n => {
        const lem = lemMap[n.identifier];
        // Extrai data de disparo do trigger
        let triggerDate = null;
        if (n.trigger?.value) triggerDate = new Date(n.trigger.value * 1000);
        else if (n.trigger?.date) triggerDate = new Date(n.trigger.date);
        else if (n.trigger?.dateComponents) {
          // DateComponents trigger (iOS)
          const dc = n.trigger.dateComponents;
          const d = new Date();
          if (dc.year)   d.setFullYear(dc.year);
          if (dc.month)  d.setMonth(dc.month - 1);
          if (dc.day)    d.setDate(dc.day);
          if (dc.hour !== undefined)  d.setHours(dc.hour);
          if (dc.minute !== undefined) d.setMinutes(dc.minute);
          d.setSeconds(0); d.setMilliseconds(0);
          triggerDate = d;
        }
        return {
          id:        n.identifier,
          titulo:    n.content?.title || lem?.produto || 'Lembrete',
          corpo:     n.content?.body  || '',
          data:      lem?.validade || '',
          horario:   lem?.horario  || '',
          tipo:      lem?.tipo     || 'agendado',
          triggerDate,
          lem,
        };
      }).filter(n => n.triggerDate); // só com data válida

      // Ordena por data mais próxima primeiro
      parsed.sort((a, b) => a.triggerDate - b.triggerDate);
      setItems(parsed);
    } catch (e) {
      console.warn('[ScheduledNotifs] Erro ao carregar:', e);
      setItems([]);
    }
    setLoading(false);
  };

  const cancelarNotif = async (item) => {
    AppAlert.alert(
      'Cancelar notificação',
      `Remover o lembrete "${item.titulo}"?`,
      [
        { text: 'Manter', style: 'cancel' },
        { text: 'Cancelar lembrete', style: 'destructive', onPress: async () => {
          try {
            await Notifications.cancelScheduledNotificationAsync(item.id);
            // Remove do storage local também
            const lista = await getLembretes();
            await saveLembretes(lista.filter(l => l.notifId !== item.id));
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch { /* noop */ }
        }},
      ]
    );
  };

  useEffect(() => {
    if (visible) {
      slideA.setValue(40); opacA.setValue(0);
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 80, friction: 10, useNativeDriver: false }),
        Animated.timing(opacA,  { toValue: 1, duration: 220, useNativeDriver: false }),
      ]).start();
      loadNotifs();
      // Tick a cada 30s para atualizar countdowns
      tickRef.current = setInterval(() => setNow(new Date()), 30000);
    } else {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [visible]);

  if (!visible) return null;

  const hoje    = items.filter(i => {
    const d = i.triggerDate;
    const n = new Date();
    return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
  });
  const futuros = items.filter(i => i.triggerDate > new Date() && !hoje.includes(i));
  const atrasados = items.filter(i => i.triggerDate <= new Date() && !hoje.includes(i));

  const Section = ({ title, color, icon, data }) => {
    if (!data.length) return null;
    return (
      <View style={{ marginBottom: 20 }}>
        <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:10 }}>
          <View style={{ width:28, height:28, borderRadius:9, backgroundColor:color+'20', justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:color+'35' }}>
            <Feather name={icon} size={13} color={color} />
          </View>
          <Text style={{ fontSize:11*fontScale, fontWeight:'900', color, textTransform:'uppercase', letterSpacing:1.1 }}>
            {title} ({data.length})
          </Text>
        </View>
        {data.map(item => {
          const cd = formatCountdown(item.triggerDate);
          const isAuto = item.tipo !== 'personalizado';
          const accentColor = isAuto ? T.amber : T.blue;
          const d = item.triggerDate;
          const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
          const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          return (
            <View key={item.id} style={{
              backgroundColor: T.bgElevated, borderRadius:18, padding:14, marginBottom:8,
              borderWidth:1.5, borderColor: accentColor+'28',
              flexDirection:'row', alignItems:'center', gap:12,
              shadowColor: accentColor, shadowOpacity:0.07, shadowRadius:8, elevation:2,
            }}>
              {/* Ícone tipo */}
              <View style={{
                width:46, height:46, borderRadius:14,
                backgroundColor: accentColor+'18',
                justifyContent:'center', alignItems:'center',
                borderWidth:1.5, borderColor: accentColor+'30',
              }}>
                <Text style={{ fontSize:22 }}>{cd.emoji}</Text>
              </View>

              {/* Conteúdo */}
              <View style={{ flex:1, gap:4 }}>
                <Text style={{ fontSize:13*fontScale, fontWeight:'900', color:T.text }} numberOfLines={2}>
                  {item.titulo}
                </Text>
                {item.corpo ? (
                  <Text style={{ fontSize:10*fontScale, color:T.textSub, fontWeight:'600' }} numberOfLines={1}>
                    {item.corpo}
                  </Text>
                ) : null}
                <View style={{ flexDirection:'row', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:2 }}>
                  {/* Countdown badge */}
                  <View style={{ paddingHorizontal:8, paddingVertical:3, borderRadius:8, backgroundColor:cd.color+'18', borderWidth:1, borderColor:cd.color+'35' }}>
                    <Text style={{ fontSize:10*fontScale, fontWeight:'900', color:cd.color }}>{cd.text}</Text>
                  </View>
                  {/* Data/hora exata */}
                  <View style={{ flexDirection:'row', alignItems:'center', gap:3, backgroundColor:T.bgInput, paddingHorizontal:7, paddingVertical:3, borderRadius:8, borderWidth:1, borderColor:T.border }}>
                    <Feather name="calendar" size={9} color={T.textMuted} />
                    <Text style={{ fontSize:9*fontScale, color:T.textMuted, fontWeight:'700' }}>{dateStr} às {timeStr}</Text>
                  </View>
                  {/* Badge tipo */}
                  <View style={{ paddingHorizontal:6, paddingVertical:2, borderRadius:6, backgroundColor: accentColor+'12' }}>
                    <Text style={{ fontSize:8*fontScale, fontWeight:'800', color: accentColor, textTransform:'uppercase' }}>
                      {isAuto ? 'auto' : 'custom'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Botão cancelar */}
              <TouchableOpacity
                onPress={() => cancelarNotif(item)}
                style={{ width:34, height:34, borderRadius:11, backgroundColor:T.redGlow, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:T.red+'25' }}>
                <Feather name="bell-off" size={14} color={T.red} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.87)', justifyContent:'flex-end' }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Animated.View style={{
          backgroundColor: T.bgCard,
          borderTopLeftRadius: 40, borderTopRightRadius: 40,
          maxHeight: '88%',
          borderTopWidth: 2.5, borderColor: '#F59E0B60',
          transform: [{ translateY: slideA }], opacity: opacA,
          shadowColor: '#F59E0B', shadowOffset:{width:0,height:-8},
          shadowOpacity: 0.3, shadowRadius: 28, elevation: 36,
          paddingBottom: 32,
        }}>
          {/* Faixa topo âmbar */}
          <View style={{ height:4, backgroundColor:'#F59E0B', borderTopLeftRadius:40, borderTopRightRadius:40, opacity:0.9 }} />

          {/* Handle */}
          <View style={{ alignItems:'center', paddingTop:10, paddingBottom:6 }}>
            <View style={{ width:38, height:4, borderRadius:2, backgroundColor:'#F59E0B40' }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection:'row', alignItems:'center', paddingHorizontal:22, paddingBottom:14, gap:14 }}>
            <View style={{ width:52, height:52, borderRadius:17, backgroundColor:'#F59E0B20', justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:'#F59E0B40' }}>
              <MaterialCommunityIcons name="bell-badge" size={26} color="#F59E0B" />
            </View>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:9*fontScale, fontWeight:'900', color:'#F59E0B', textTransform:'uppercase', letterSpacing:1.6 }}>
                SISTEMA DE ALERTAS
              </Text>
              <Text style={{ fontSize:18*fontScale, fontWeight:'900', color:T.text, marginTop:2 }}>
                Notificações Agendadas
              </Text>
            </View>
            {loading
              ? <ActivityIndicator color="#F59E0B" />
              : <TouchableOpacity onPress={loadNotifs} style={{ width:38, height:38, borderRadius:12, backgroundColor:'#F59E0B15', justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:'#F59E0B30' }}>
                  <Feather name="refresh-cw" size={16} color="#F59E0B" />
                </TouchableOpacity>
            }
            <TouchableOpacity onPress={onClose} style={{ width:38, height:38, borderRadius:12, backgroundColor:T.bgInput, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:T.border }}>
              <Feather name="x" size={17} color={T.textSub} />
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={{ flexDirection:'row', gap:8, paddingHorizontal:22, marginBottom:16 }}>
            {[
              { label:'Total', value:items.length, color:'#F59E0B', icon:'bell' },
              { label:'Hoje', value:hoje.length, color:T.green, icon:'sun' },
              { label:'Futuros', value:futuros.length, color:T.blue, icon:'calendar' },
              { label:'Passou', value:atrasados.length, color:T.red, icon:'alert-circle' },
            ].map(s => (
              <View key={s.label} style={{ flex:1, backgroundColor:T.bgElevated, borderRadius:14, padding:8, alignItems:'center', borderWidth:1.5, borderColor:s.color+'20' }}>
                <Feather name={s.icon} size={14} color={s.color} style={{marginBottom:3}} />
                <Text style={{ fontSize:16*fontScale, fontWeight:'900', color:s.color }}>{s.value}</Text>
                <Text style={{ fontSize:8*fontScale, color:T.textMuted, fontWeight:'700', textTransform:'uppercase', marginTop:1 }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Lista */}
          <ScrollView style={{ paddingHorizontal:22 }} showsVerticalScrollIndicator={false}>
            {loading && (
              <View style={{ alignItems:'center', paddingVertical:40, gap:12 }}>
                <ActivityIndicator size="large" color="#F59E0B" />
                <Text style={{ color:T.textMuted, fontWeight:'700', fontSize:13*fontScale }}>Carregando notificações...</Text>
              </View>
            )}

            {!loading && items.length === 0 && (
              <View style={{ alignItems:'center', paddingVertical:48, gap:10 }}>
                <View style={{ width:72, height:72, borderRadius:24, backgroundColor:'#F59E0B12', justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:'#F59E0B25' }}>
                  <MaterialCommunityIcons name="bell-sleep-outline" size={36} color="#F59E0B50" />
                </View>
                <Text style={{ fontSize:16*fontScale, fontWeight:'900', color:T.textSub, marginTop:4 }}>Nenhuma notificação agendada</Text>
                <Text style={{ fontSize:12*fontScale, color:T.textMuted, textAlign:'center', lineHeight:18 }}>
                  Use o assistente de voz ou o painel de lembretes para agendar alertas.
                </Text>
              </View>
            )}

            {!loading && (
              <>
                <Section title="Hoje" color={T.green} icon="sun" data={hoje} />
                <Section title="Próximas" color={T.blue} icon="calendar" data={futuros} />
                <Section title="Passou" color={T.red} icon="alert-circle" data={atrasados} />
              </>
            )}
            <View style={{height:12}} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const NotificationPermissionModal = ({ visible, onConfirm, onCancel, T, fontScale }) => {
  const slideA  = useRef(new Animated.Value(60)).current;
  const opacA   = useRef(new Animated.Value(0)).current;
  const scaleA  = useRef(new Animated.Value(0.88)).current;
  const ringA   = useRef(new Animated.Value(1)).current;
  const ringLoop = useRef(null);

  useEffect(() => {
    if (visible) {
      // Entrada do card
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, tension: 55, friction: 11, useNativeDriver: false }),
        Animated.timing(opacA,  { toValue: 1, duration: 280, useNativeDriver: false }),
        Animated.spring(scaleA, { toValue: 1, tension: 55, friction: 11, useNativeDriver: false }),
      ]).start();
      // Pulsação do ícone
      ringLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(ringA, { toValue: 1.18, duration: 750, useNativeDriver: false }),
        Animated.timing(ringA, { toValue: 1,    duration: 750, useNativeDriver: false }),
      ]));
      ringLoop.current.start();
    } else {
      ringLoop.current?.stop();
      Animated.parallel([
        Animated.timing(slideA, { toValue: 60,  duration: 220, useNativeDriver: false }),
        Animated.timing(opacA,  { toValue: 0,   duration: 180, useNativeDriver: false }),
        Animated.timing(scaleA, { toValue: 0.9, duration: 200, useNativeDriver: false }),
      ]).start();
    }
    return () => ringLoop.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slideA, opacA, scaleA, ringA]);

  if (!visible) return null;

  const features = [
    { icon: 'package-variant-closed', label: 'Produtos vencendo' },
    { icon: 'bell-ring-outline',      label: 'Lembretes agendados' },
    { icon: 'robot-outline',          label: 'Alertas inteligentes IA' },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', padding: 22 }}>
        {/* Toque fora cancela */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />

        <Animated.View style={{
          backgroundColor: T.bgCard,
          borderRadius: 38,
          overflow: 'hidden',
          borderWidth: 1.5,
          borderColor: T.blue + '45',
          transform: [{ translateY: slideA }, { scale: scaleA }],
          opacity: opacA,
          shadowColor: T.blue,
          shadowOpacity: 0.45,
          shadowRadius: 32,
          elevation: 22,
        }}>

          {/* ── Faixa de gradiente decorativa no topo ── */}
          <View style={{
            height: 6, width: '100%',
            backgroundColor: T.blue,
            opacity: 0.85,
          }} />

          <View style={{ padding: 30, alignItems: 'center' }}>

            {/* Ícone pulsante em anéis */}
            <View style={{ width: 96, height: 96, justifyContent: 'center', alignItems: 'center', marginBottom: 22 }}>
              {/* Anel externo pulsante */}
              <Animated.View style={{
                position: 'absolute',
                width: 96, height: 96, borderRadius: 48,
                borderWidth: 1.5, borderColor: T.blue + '30',
                transform: [{ scale: ringA }],
              }} />
              {/* Anel médio */}
              <View style={{
                position: 'absolute',
                width: 76, height: 76, borderRadius: 38,
                borderWidth: 1, borderColor: T.blue + '45',
              }} />
              {/* Círculo principal */}
              <View style={{
                width: 60, height: 60, borderRadius: 30,
                backgroundColor: T.blue + '18',
                justifyContent: 'center', alignItems: 'center',
                borderWidth: 2, borderColor: T.blue + '55',
                shadowColor: T.blue, shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
              }}>
                <MaterialCommunityIcons name="bell-ring" size={28} color={T.blue} />
              </View>
            </View>

            {/* Badge GEI.AI */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: T.blue + '12', borderRadius: 20,
              paddingHorizontal: 12, paddingVertical: 4,
              borderWidth: 1, borderColor: T.blue + '28',
              marginBottom: 10,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.blue }} />
              <Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 1.4 }}>
                GEI.AI · ASSISTENTE
              </Text>
            </View>

            <Text style={{ fontSize: 22 * fontScale, fontWeight: '900', color: T.text, textAlign: 'center', letterSpacing: -0.5, marginBottom: 8 }}>
              Fique sempre avisado
            </Text>

            <Text style={{ fontSize: 13.5 * fontScale, color: T.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 22 }}>
              Ative as notificações para que o GEI.AI te avise em tempo real sobre:
            </Text>

            {/* Feature chips */}
            <View style={{ width: '100%', gap: 8, marginBottom: 24 }}>
              {features.map((f, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: T.bgElevated, borderRadius: 14, padding: 11,
                  borderWidth: 1, borderColor: T.border,
                }}>
                  <View style={{
                    width: 32, height: 32, borderRadius: 10,
                    backgroundColor: T.blue + '15', justifyContent: 'center', alignItems: 'center',
                    borderWidth: 1, borderColor: T.blue + '25',
                  }}>
                    <MaterialCommunityIcons name={f.icon} size={16} color={T.blue} />
                  </View>
                  <Text style={{ fontSize: 13 * fontScale, fontWeight: '700', color: T.text }}>{f.label}</Text>
                  <Feather name="check" size={13} color={T.blue} style={{ marginLeft: 'auto' }} />
                </View>
              ))}
            </View>

            {/* Botões */}
            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity
                onPress={onConfirm}
                activeOpacity={0.85}
                style={{
                  backgroundColor: T.blue,
                  paddingVertical: 15,
                  borderRadius: 18,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  shadowColor: T.blue, shadowOpacity: 0.5, shadowRadius: 14, elevation: 8,
                }}>
                <MaterialCommunityIcons name="bell-check-outline" size={20} color="#FFF" />
                <Text style={{ color: '#FFF', fontSize: 15 * fontScale, fontWeight: '900' }}>Ativar Notificações</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onCancel}
                activeOpacity={0.7}
                style={{
                  paddingVertical: 13,
                  borderRadius: 18,
                  alignItems: 'center',
                  backgroundColor: T.bgInput,
                  borderWidth: 1, borderColor: T.border,
                }}>
                <Text style={{ color: T.textMuted, fontSize: 13 * fontScale, fontWeight: '700' }}>Lembrar depois</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 9.5 * fontScale, color: T.textMuted, marginTop: 16, textAlign: 'center', lineHeight: 14 }}>
              {Platform.OS === 'web'
                ? 'Requer Chrome, Edge ou outro navegador moderno.'
                : 'Você pode revogar a qualquer momento nas Configurações do sistema.'}
            </Text>

          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: PainelInteligenteScreen — Central de Inteligência de Estoque
// ─────────────────────────────────────────────────────────────────────────────
const PainelInteligenteScreen = ({ visible, onClose, stockData, fifoMode, T, fontScale, onNavigate, embedded }) => {
  const [activeTab, setActiveTab] = useState('fifo');
  const slideA = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const opacA  = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
        Animated.timing(opacA, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideA, { toValue: Dimensions.get('window').height, duration: 260, useNativeDriver: true }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slideA, opacA]);

  const fifoInfo = useMemo(() => detectFifoGroups(stockData || []), [stockData]);
  const agora = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const parseD = s => { if (!s) return null; const [d,m,y]=String(s).split('/'); const dt=new Date(`${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}T00:00:00`); return isNaN(dt)?null:dt; };

  // Produtos críticos (vence em ≤7 dias ou vencido)
  const criticos = useMemo(() => (stockData||[]).filter(p => {
    const dt = parseD(p.VENCIMENTO); if (!dt) return false;
    return Math.floor((dt - agora) / 86400000) <= 7;
  }).sort((a,b) => (parseD(a.VENCIMENTO)||0) - (parseD(b.VENCIMENTO)||0)), [stockData, agora]);

  // Produtos com ruptura eminente (giro × dias restantes ≤ estoque)
  const rupturaRisco = useMemo(() => (stockData||[]).filter(p => {
    const m = buildDepletionMetrics(p, fifoMode, stockData, p.codig);
    return m && m.remainingPct <= 15 && m.remainingQty > 0;
  }), [stockData, fifoMode]);

  // Sugestão de reposição (giro vs qtd)
  const sugestoes = useMemo(() => {
    const rateMap = { 'Grande giro': 8, 'Médio giro': 3, 'Pouco giro': 0.8 };
    return (stockData||[])
      .map(p => {
        const rate = rateMap[p.MARGEM] || 3;
        const qty = Math.max(0, parseInt(p.quantidade) || 0);
        const diasRestantes = rate > 0 ? Math.ceil(qty / rate) : 999;
        return { ...p, diasRestantes, rate };
      })
      .filter(p => p.diasRestantes <= 14 && p.diasRestantes >= 0)
      .sort((a,b) => a.diasRestantes - b.diasRestantes);
  }, [stockData]);

  const TABS = [
    { key:'fifo',    label:'FIFO',     icon:'layers'       },
    { key:'critico', label:'Críticos', icon:'alert-circle' },
    { key:'ruptura', label:'Ruptura',  icon:'trending-down'},
    { key:'pedido',  label:'Pedidos',  icon:'shopping-cart'},
  ];

  const WIN2 = Dimensions.get('window');
  if (!embedded && !visible && slideA._value >= WIN2.height - 10) return null;

  const cardStyle = embedded ? {
    flex: 1,
    backgroundColor: T.bgCard,
  } : {
    position:'absolute', bottom:0, left:0, right:0,
    height: WIN2.height * 0.88,
    backgroundColor: T.bgCard,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    borderWidth:1, borderColor: T.border,
    shadowColor:'#000', shadowOffset:{width:0,height:-12},
    shadowOpacity:0.55, shadowRadius:28, elevation:36,
    transform:[{translateY: slideA}],
  };

  const cardContent = (
    <Animated.View style={cardStyle}>
          {/* Faixa topo teal */}
          <View style={{height:4,backgroundColor:T.teal,borderTopLeftRadius:32,borderTopRightRadius:32,opacity:0.9}} />
          {/* Handle */}
          <View style={{alignItems:'center',paddingTop:10,paddingBottom:2}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:T.teal+'50'}} />
          </View>

          {/* Header */}
          <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:22,paddingVertical:10,gap:12}}>
            <View style={{width:50,height:50,borderRadius:17,backgroundColor:T.teal,justifyContent:'center',alignItems:'center'}}>
              <MaterialCommunityIcons name="brain" size={24} color="#FFF" />
            </View>
            <View style={{flex:1}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:5}}>
                <View style={{width:6,height:6,borderRadius:3,backgroundColor:T.teal}} />
                <Text style={{fontSize:8*fontScale,fontWeight:'900',color:T.teal,textTransform:'uppercase',letterSpacing:1.5}}>GEI.AI · CENTRAL DE INTELIGÊNCIA</Text>
              </View>
              <Text style={{fontSize:17*fontScale,fontWeight:'900',color:T.text,letterSpacing:-0.3}}>Painel Inteligente</Text>
              <Text style={{fontSize:10*fontScale,color:T.textSub,fontWeight:'700',marginTop:1}}>
                {stockData?.length||0} produtos · {criticos.length} críticos · {fifoInfo.groups.length} grupos FIFO
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{width:36,height:36,borderRadius:14,backgroundColor:T.bgInput,justifyContent:'center',alignItems:'center'}}>
              <Feather name="x" size={16} color={T.textSub} />
            </TouchableOpacity>
          </View>

          {/* Tab pills — redesenhado: pill cheio quando ativo */}
          <View style={{flexDirection:'row',paddingHorizontal:16,gap:8,marginBottom:14}}>
            {TABS.map(tab => {
              const on = activeTab === tab.key;
              const badge = tab.key==='critico' ? criticos.length : tab.key==='ruptura' ? rupturaRisco.length : tab.key==='pedido' ? sugestoes.length : tab.key==='fifo' ? fifoInfo.groups.length : 0;
              return (
                <TouchableOpacity key={tab.key} onPress={()=>setActiveTab(tab.key)} style={[{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',paddingVertical:9,borderRadius:14,gap:4,backgroundColor:T.bgInput},on&&{backgroundColor:T.teal}]}>
                  <Feather name={tab.icon} size={12} color={on?'#FFF':T.textSub} />
                  <Text style={{fontSize:10*fontScale,fontWeight:'800',color:on?'#FFF':T.textSub}}>{tab.label}</Text>
                  {badge>0 && <View style={{minWidth:16,height:16,paddingHorizontal:3,borderRadius:8,backgroundColor:on?'rgba(255,255,255,0.3)':T.textMuted,justifyContent:'center',alignItems:'center'}}><Text style={{fontSize:9,fontWeight:'900',color:'#FFF'}}>{badge}</Text></View>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Conteúdo */}
          <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:40}} showsVerticalScrollIndicator={false}>

            {/* ── Tab FIFO ── */}
            {activeTab==='fifo' && (
              <View>
                <View style={{backgroundColor:T.tealGlow,borderRadius:16,padding:14,borderWidth:1,borderColor:T.teal+'30',marginBottom:16}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:6}}>
                    <MaterialCommunityIcons name="layers-triple" size={16} color={T.teal} />
                    <Text style={{fontSize:11*fontScale,fontWeight:'900',color:T.teal,textTransform:'uppercase',letterSpacing:0.8}}>O que é FIFO?</Text>
                  </View>
                  <Text style={{fontSize:12*fontScale,color:T.textSub,fontWeight:'600',lineHeight:18}}>Quando há múltiplos lotes do mesmo produto, o FIFO garante que o lote com validade mais próxima seja consumido primeiro, evitando perdas.</Text>
                </View>
                {fifoInfo.groups.length === 0 ? (
                  <View style={{alignItems:'center',paddingVertical:40}}>
                    <MaterialCommunityIcons name="check-circle-outline" size={48} color={T.green} />
                    <Text style={{fontSize:15*fontScale,fontWeight:'800',color:T.text,marginTop:12}}>Nenhum grupo FIFO detectado</Text>
                    <Text style={{fontSize:12*fontScale,color:T.textSub,marginTop:4,textAlign:'center'}}>Todos os produtos têm apenas 1 lote ativo.</Text>
                  </View>
                ) : fifoInfo.groups.map((g, i) => {
                  const lotesProduto = (stockData||[]).filter(p => {
                    if (g.type==='ean') return (p.codig||'').trim()===g.key;
                    return stripAccents((p.produto||'').toLowerCase().trim()).startsWith(g.key);
                  }).sort((a,b)=>(parseD(a.VENCIMENTO)||0)-(parseD(b.VENCIMENTO)||0));
                  const primeiro = lotesProduto[0];
                  const nomeProduto = primeiro?.produto || g.key;
                  const diasAtePrimeiro = primeiro?.VENCIMENTO ? Math.floor(((parseD(primeiro.VENCIMENTO)||agora) - agora)/86400000) : null;
                  return (
                    <View key={i} style={{backgroundColor:T.bgElevated,borderRadius:16,padding:14,borderWidth:1,borderColor:T.border,marginBottom:10}}>
                      <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8}}>
                        <View style={{width:8,height:8,borderRadius:4,backgroundColor:diasAtePrimeiro!==null&&diasAtePrimeiro<=7?T.red:T.teal}} />
                        <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.text,flex:1}} numberOfLines={1}>{nomeProduto}</Text>
                        <View style={{backgroundColor:T.tealGlow,borderRadius:8,paddingHorizontal:8,paddingVertical:3,borderWidth:1,borderColor:T.teal+'30'}}>
                          <Text style={{fontSize:10*fontScale,fontWeight:'800',color:T.teal}}>{lotesProduto.length} lotes</Text>
                        </View>
                      </View>
                      {lotesProduto.map((lote, li) => {
                        const dt = parseD(lote.VENCIMENTO);
                        const dias = dt ? Math.floor((dt-agora)/86400000) : null;
                        const cor = dias===null?T.textSub:dias<=0?T.red:dias<=7?T.amber:T.green;
                        return (
                          <View key={li} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:5,borderTopWidth:li>0?1:0,borderColor:T.border}}>
                            <View style={{width:20,height:20,borderRadius:6,backgroundColor:li===0?T.teal:T.bgInput,justifyContent:'center',alignItems:'center',borderWidth:li===0?0:1,borderColor:T.border}}>
                              <Text style={{fontSize:9,fontWeight:'900',color:li===0?'#FFF':T.textMuted}}>{li+1}</Text>
                            </View>
                            <Text style={{fontSize:11*fontScale,color:T.textSub,flex:1}} numberOfLines={1}>{lote.VENCIMENTO||'?'} · {lote.quantidade||'?'} un</Text>
                            <View style={{backgroundColor:cor+'18',borderRadius:6,paddingHorizontal:6,paddingVertical:2,borderWidth:1,borderColor:cor+'35'}}>
                              <Text style={{fontSize:9*fontScale,fontWeight:'800',color:cor}}>{dias===null?'?':dias<=0?'VENCIDO':`${dias}d`}</Text>
                            </View>
                          </View>
                        );
                      })}
                      <Text style={{fontSize:9.5*fontScale,color:T.textMuted,marginTop:6,fontStyle:'italic'}}>
                        {g.type==='ean'?`EAN: ${g.key}`:`Nome: "${g.key}..." · tipo nome`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Tab Críticos ── */}
            {activeTab==='critico' && (
              <View>
                {criticos.length===0 ? (
                  <View style={{alignItems:'center',paddingVertical:40}}>
                    <Feather name="check-circle" size={48} color={T.green} />
                    <Text style={{fontSize:15*fontScale,fontWeight:'800',color:T.text,marginTop:12}}>Nenhum produto crítico</Text>
                    <Text style={{fontSize:12*fontScale,color:T.textSub,marginTop:4}}>Todos os produtos estão com prazo seguro.</Text>
                  </View>
                ) : criticos.map((p,i) => {
                  const dt = parseD(p.VENCIMENTO);
                  const dias = dt ? Math.floor((dt-agora)/86400000) : null;
                  const cor = dias===null?T.textSub:dias<=0?T.red:dias<=3?T.red:T.amber;
                  return (
                    <View key={i} style={{flexDirection:'row',alignItems:'center',gap:12,padding:12,backgroundColor:cor+'0E',borderRadius:14,borderWidth:1,borderColor:cor+'30',marginBottom:8}}>
                      <View style={{width:40,height:40,borderRadius:12,backgroundColor:cor+'18',justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:cor+'40'}}>
                        <Feather name={dias!==null&&dias<=0?'x-circle':'alert-triangle'} size={18} color={cor} />
                      </View>
                      <View style={{flex:1}}>
                        <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.text}} numberOfLines={1}>{p.produto||'Produto'}</Text>
                        <Text style={{fontSize:11*fontScale,color:T.textSub,marginTop:2}}>{p.quantidade||'?'} un · vence {p.VENCIMENTO||'?'}</Text>
                      </View>
                      <View style={{backgroundColor:cor+'18',borderRadius:10,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:cor+'35'}}>
                        <Text style={{fontSize:11*fontScale,fontWeight:'900',color:cor}}>{dias===null?'?':dias<=0?'VENCIDO':`${dias}d`}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Tab Ruptura ── */}
            {activeTab==='ruptura' && (
              <View>
                <View style={{backgroundColor:T.amberGlow,borderRadius:14,padding:12,borderWidth:1,borderColor:T.amber+'30',marginBottom:10}}>
                  <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.amber}}>⚠️ Produtos com menos de 15% de estoque restante estimado (baseado no giro).</Text>
                </View>
                <View style={{flexDirection:'row',alignItems:'center',gap:7,marginBottom:14,paddingHorizontal:4}}>
                  <View style={{width:7,height:7,borderRadius:4,backgroundColor:T.green}} />
                  <Text style={{fontSize:10.5*fontScale,fontWeight:'700',color:T.textSub}}>Monitoramento automático ativo · você recebe um aviso por notificação se algum item entrar em risco</Text>
                </View>
                {rupturaRisco.length===0 ? (
                  <View style={{alignItems:'center',paddingVertical:40}}>
                    <Feather name="check-circle" size={48} color={T.green} />
                    <Text style={{fontSize:15*fontScale,fontWeight:'800',color:T.text,marginTop:12}}>Sem risco de ruptura iminente</Text>
                  </View>
                ) : rupturaRisco.map((p,i) => {
                  const m = buildDepletionMetrics(p, fifoMode, stockData, p.codig);
                  const pct = m?.remainingPct || 0;
                  const cor = pct<=5?T.red:T.amber;
                  return (
                    <View key={i} style={{padding:12,backgroundColor:T.bgElevated,borderRadius:14,borderWidth:1,borderColor:T.border,marginBottom:8}}>
                      <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:8}}>
                        <Feather name="trending-down" size={16} color={cor} />
                        <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.text,flex:1}} numberOfLines={1}>{p.produto||'Produto'}</Text>
                        <Text style={{fontSize:10*fontScale,fontWeight:'900',color:cor}}>{pct}% restante</Text>
                      </View>
                      <View style={{height:6,backgroundColor:T.bgInput,borderRadius:3,overflow:'hidden'}}>
                        <View style={{height:'100%',width:`${pct}%`,backgroundColor:cor,borderRadius:3}} />
                      </View>
                      <Text style={{fontSize:10*fontScale,color:T.textSub,marginTop:6}}>{m?.remainingQty||0} un restantes · ruptura em ~{m?.remainingDays||0} dias · {p.MARGEM||'Médio giro'}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Tab Pedidos ── */}
            {activeTab==='pedido' && (
              <View>
                <View style={{backgroundColor:T.purpleGlow,borderRadius:14,padding:12,borderWidth:1,borderColor:T.purple+'30',marginBottom:14}}>
                  <Text style={{fontSize:11*fontScale,fontWeight:'800',color:T.purple}}>🛒 Produtos que precisam de reposição nos próximos 14 dias com base no giro.</Text>
                </View>
                {sugestoes.length===0 ? (
                  <View style={{alignItems:'center',paddingVertical:40}}>
                    <Feather name="check-circle" size={48} color={T.green} />
                    <Text style={{fontSize:15*fontScale,fontWeight:'800',color:T.text,marginTop:12}}>Estoque OK nos próximos 14 dias</Text>
                  </View>
                ) : sugestoes.map((p,i) => {
                  const gCfg = { 'Grande giro':{c:T.green,icon:'trending-up'}, 'Médio giro':{c:T.amber,icon:'minus'}, 'Pouco giro':{c:T.red,icon:'trending-down'} }[p.MARGEM||'Médio giro'] || {c:T.amber,icon:'minus'};
                  return (
                    <View key={i} style={{flexDirection:'row',alignItems:'center',gap:12,padding:12,backgroundColor:T.bgElevated,borderRadius:14,borderWidth:1,borderColor:T.border,marginBottom:8}}>
                      <View style={{width:40,height:40,borderRadius:12,backgroundColor:gCfg.c+'18',justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:gCfg.c+'40'}}>
                        <Feather name={gCfg.icon} size={18} color={gCfg.c} />
                      </View>
                      <View style={{flex:1}}>
                        <Text style={{fontSize:13*fontScale,fontWeight:'800',color:T.text}} numberOfLines={1}>{p.produto||'Produto'}</Text>
                        <Text style={{fontSize:11*fontScale,color:T.textSub,marginTop:2}}>{p.quantidade||'?'} un · ~{p.rate} un/dia · {p.MARGEM||'Médio giro'}</Text>
                      </View>
                      <View style={{backgroundColor:p.diasRestantes<=7?T.redGlow:T.amberGlow,borderRadius:10,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:p.diasRestantes<=7?T.red+'35':T.amber+'35'}}>
                        <Text style={{fontSize:11*fontScale,fontWeight:'900',color:p.diasRestantes<=7?T.red:T.amber}}>em {p.diasRestantes}d</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

          </ScrollView>
    </Animated.View>
  );

  if (embedded) return cardContent;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', opacity:opacA }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {cardContent}
      </Animated.View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: JarvisCentralModal — Painel único do JARVIS
// Reúne em um só modal: Cadastro/Chat por voz, Novidades e Painel Inteligente.
// Abre via comando de voz ("abrir jarvis", "inteligente", "robo" etc.) e já
// ativa o microfone do JARVIS (sem precisar de clique).
// ─────────────────────────────────────────────────────────────────────────────
const JarvisCentralModal = ({
  visible, onClose, T, fontScale, initialTab,
  // chat / jarvis
  msgs, chatTxt, setChatTxt, sendChat, sendChatVoice, chatBusy, scrollRef, TAB_H, NAV_BAR_H,
  setJarvisVoiceMode, jarvisVoiceMode, jarvisRecording, jarvisProcessing, onProgressDone,
  // novidades
  stockData, userData,
  // painel inteligente
  fifoMode,
}) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'chat');
  const slideA = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const opacA  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab || 'chat');
      Animated.parallel([
        Animated.spring(slideA, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
        Animated.timing(opacA, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideA, { toValue: Dimensions.get('window').height, duration: 260, useNativeDriver: true }),
        Animated.timing(opacA, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialTab]);

  const TABS = [
    { key: 'chat',      label: 'JARVIS',    icon: 'message-circle' },
    { key: 'novidades', label: 'Novidades', icon: 'cpu' },
    { key: 'painel',    label: 'Inteligência', icon: 'bar-chart-2' },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', opacity: opacA }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: T.bg,
          transform: [{ translateY: slideA }],
        }}>
          {/* ── Header com tabs ─────────────────────────────────────────── */}
          <View style={{ paddingTop: 54, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: T.bgCard, borderBottomWidth: 1, borderColor: T.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: T.teal + '22', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.teal + '50' }}>
                  <MaterialCommunityIcons name="robot-outline" size={20} color={T.teal} />
                </View>
                <Text style={{ fontSize: 18 * fontScale, fontWeight: '900', color: T.text }}>Painel JARVIS</Text>
                {jarvisVoiceMode && (jarvisRecording || jarvisProcessing) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.teal + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.teal }} />
                    <Text style={{ fontSize: 11 * fontScale, fontWeight: '800', color: T.teal }}>{jarvisProcessing ? 'Processando' : 'Ouvindo'}</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setJarvisVoiceMode(p => !p)}
                  style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: jarvisVoiceMode ? T.teal : T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: jarvisVoiceMode ? T.teal : T.border }}>
                  <Feather name={jarvisVoiceMode ? 'mic' : 'mic-off'} size={18} color={jarvisVoiceMode ? '#fff' : T.textSub} />
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}>
                  <Feather name="x" size={18} color={T.textSub} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TABS.map(t => {
                const on = activeTab === t.key;
                return (
                  <TouchableOpacity key={t.key} onPress={() => setActiveTab(t.key)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 14, backgroundColor: on ? T.teal + '20' : T.bgInput, borderWidth: 1.5, borderColor: on ? T.teal : T.border }}>
                    <Feather name={t.icon} size={14} color={on ? T.teal : T.textSub} />
                    <Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: on ? T.teal : T.textSub }}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Conteúdo das abas ───────────────────────────────────────── */}
          <View style={{ flex: 1 }}>
            {activeTab === 'chat' && (
              <ChatScreen
                T={T} fontScale={fontScale} msgs={msgs} chatTxt={chatTxt} setChatTxt={setChatTxt}
                sendChat={sendChat} sendChatVoice={sendChatVoice} busy={chatBusy} scrollRef={scrollRef}
                TAB_H={TAB_H} NAV_BAR_H={NAV_BAR_H} onVoiceMode={setJarvisVoiceMode}
                jarvisRecording={jarvisRecording} jarvisProcessing={jarvisProcessing} jarvisBusy={chatBusy}
                onProgressDone={onProgressDone}
              />
            )}
            {activeTab === 'novidades' && (
              <NovidadesModal
                visible={true} embedded onClose={onClose} stockData={stockData} T={T} fontScale={fontScale} userData={userData}
              />
            )}
            {activeTab === 'painel' && (
              <PainelInteligenteScreen
                visible={true} embedded onClose={onClose} stockData={stockData} fifoMode={fifoMode} T={T} fontScale={fontScale}
              />
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  SCANNER MODAL PREMIUM  ─  v4.0 — Cinema-grade redesign
// ════════════════════════════════════════════════════════════════════════════
const SCAN = {
  BW: 300, BH: 165,   // barcode frame
  AW: 268,            // AI Vision circle diameter
  CS: 28, CT: 3,      // corner size / thickness
};

// ─── Paleta ────────────────────────────────────────────────────────────────
const NEON_BLUE   = '#3B82F6';
const NEON_CYAN   = '#06B6D4';
const NEON_PURPLE = '#8B5CF6';
const NEON_VIOLET = '#7C3AED';

// ─── Canto angulado do viewfinder ─────────────────────────────────────────
const VCorner = ({ pos, color }) => {
  const base = { position:'absolute', width: SCAN.CS, height: SCAN.CS };
  const bw   = SCAN.CT;
  const styles = {
    TL: { top:-1, left:-1,   borderTopWidth:bw, borderLeftWidth:bw,   borderTopLeftRadius:6 },
    TR: { top:-1, right:-1,  borderTopWidth:bw, borderRightWidth:bw,  borderTopRightRadius:6 },
    BL: { bottom:-1,left:-1, borderBottomWidth:bw,borderLeftWidth:bw, borderBottomLeftRadius:6 },
    BR: { bottom:-1,right:-1,borderBottomWidth:bw,borderRightWidth:bw,borderBottomRightRadius:6 },
  };
  return <View style={[base, styles[pos], { borderColor: color }]} />;
};

// ─── Partícula flutuante (AI Vision) ──────────────────────────────────────
const FloatDot = ({ angle, radius, size, color, orbitAnim, phase }) => {
  const rot = orbitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [`${angle}deg`, `${angle + 360}deg`],
  });
  return (
    <Animated.View style={{
      position: 'absolute',
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      shadowColor: color, shadowOpacity: 1, shadowRadius: size * 2,
      opacity: 0.85,
      transform: [
        { rotate: rot },
        { translateX: radius },
      ],
    }} />
  );
};

// ─── Anel pulsante ────────────────────────────────────────────────────────
const PulseRing = ({ size, color, anim, delay = 0, strokeW = 1.5 }) => {
  const scale = anim.interpolate({ inputRange:[0,1], outputRange:[0.6, 1.6] });
  const opacity = anim.interpolate({ inputRange:[0,0.3,1], outputRange:[0, 0.7, 0] });
  return (
    <Animated.View style={{
      position: 'absolute',
      width: size, height: size, borderRadius: size / 2,
      borderWidth: strokeW, borderColor: color,
      transform: [{ scale }], opacity,
    }} />
  );
};

// ─── Barra de progresso consultando ───────────────────────────────────────
const ScanProgressBar = ({ prog, color }) => (
  <View style={{ width: 200, height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
    <Animated.View style={{
      height: 3, borderRadius: 2,
      backgroundColor: color,
      shadowColor: color, shadowOpacity: 1, shadowRadius: 8,
      width: prog.interpolate({ inputRange:[0,1], outputRange:['0%','100%'] }),
    }} />
  </View>
);

// ─── Main Scanner ──────────────────────────────────────────────────────────
const ScannerModalPremium = ({
  visible, scanMode, camRef, torchOn, setTorchOn,
  onBarcode, onClose, onAIVisionCameraReady,
  showAchandoGif, T, isDarkEnv, fontScale, scanAnim, pulseAnim,
}) => {
  const { width: SW, height: SH } = Dimensions.get('window');

  // ── Refs de animação ──────────────────────────────────────────────────────
  const mountAnim    = useRef(new Animated.Value(0)).current;
  const bgBlur       = useRef(new Animated.Value(0)).current;
  const laserAnim    = useRef(new Animated.Value(0)).current;
  const laserOpacity = useRef(new Animated.Value(0)).current;
  const cornerGlow   = useRef(new Animated.Value(0)).current;
  const frameBreath  = useRef(new Animated.Value(1)).current;
  const orbitFast    = useRef(new Animated.Value(0)).current;
  const orbitSlow    = useRef(new Animated.Value(0)).current;
  const pulse1       = useRef(new Animated.Value(0)).current;
  const pulse2       = useRef(new Animated.Value(0)).current;
  const pulse3       = useRef(new Animated.Value(0)).current;
  const aiCoreScale  = useRef(new Animated.Value(1)).current;
  const aiCoreBright = useRef(new Animated.Value(0)).current;
  const torchBtnA    = useRef(new Animated.Value(1)).current;
  const headerSlide  = useRef(new Animated.Value(-80)).current;
  const hintFade     = useRef(new Animated.Value(0)).current;
  const consultAnim  = useRef(new Animated.Value(0)).current;
  const consultProg  = useRef(new Animated.Value(0)).current;
  const consultSpin  = useRef(new Animated.Value(0)).current;
  const srcPulse     = useRef(new Animated.Value(1)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const scanLineX    = useRef(new Animated.Value(0)).current;

  const [tipIdx,   setTipIdx]   = React.useState(0);
  const [srcIdx,   setSrcIdx]   = React.useState(0);
  const [dotCount, setDotCount] = React.useState(0);

  const TIPS_B = ['📏 15–25 cm de distância','💡 Evite reflexo na embalagem','🔄 Centralize o código','⚡ Use flash em locais escuros'];
  const TIPS_A = ['📸 Aponte para a frente da embalagem','🎯 Produto centralizado','💡 Boa iluminação ajuda','🏷️ Mostre a etiqueta principal'];
  const SOURCES = [
    { label:'Bluesoft Cosmos', icon:'database',   color: NEON_CYAN   },
    { label:'GEI Vision IA',   icon:'cpu',        color: NEON_PURPLE },
    { label:'Open Food Facts', icon:'server',     color:'#10B981'    },
  ];

  const tips = scanMode === 'barcode' ? TIPS_B : TIPS_A;
  const acColor = scanMode === 'barcode' ? NEON_BLUE : NEON_PURPLE;
  const src = SOURCES[srcIdx];

  // ── Entrada ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) { mountAnim.setValue(0); headerSlide.setValue(-80); hintFade.setValue(0); return; }
    Animated.parallel([
      Animated.timing(mountAnim,   { toValue:1, duration:420, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
      Animated.timing(headerSlide, { toValue:0, duration:380, delay:80, easing:Easing.out(Easing.back(1.4)), useNativeDriver:true }),
      Animated.timing(hintFade,    { toValue:1, duration:500, delay:300, useNativeDriver:true }),
    ]).start();
  }, [visible]);

  // ── Loop laser barcode ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible || scanMode !== 'barcode') return;
    laserOpacity.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(laserOpacity, { toValue:1, duration:200, useNativeDriver:true }),
      Animated.timing(laserAnim,    { toValue:1, duration:1800, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
      Animated.timing(laserOpacity, { toValue:0, duration:200, useNativeDriver:true }),
      Animated.delay(120),
      Animated.timing(laserAnim,    { toValue:0, duration:0, useNativeDriver:true }),
    ]));
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(cornerGlow,  { toValue:1, duration:900, easing:Easing.inOut(Easing.sin), useNativeDriver:false }),
      Animated.timing(cornerGlow,  { toValue:0, duration:900, easing:Easing.inOut(Easing.sin), useNativeDriver:false }),
    ]));
    const breath = Animated.loop(Animated.sequence([
      Animated.timing(frameBreath, { toValue:1.008, duration:1400, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
      Animated.timing(frameBreath, { toValue:1,     duration:1400, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
    ]));
    // Linha scan horizontal extra (efeito cinema)
    const hLoop = Animated.loop(Animated.sequence([
      Animated.timing(scanLineX, { toValue:1, duration:2200, easing:Easing.linear, useNativeDriver:true }),
      Animated.timing(scanLineX, { toValue:0, duration:0, useNativeDriver:true }),
      Animated.delay(300),
    ]));
    loop.start(); glow.start(); breath.start(); hLoop.start();
    const ti = setInterval(() => setTipIdx(i => (i+1) % tips.length), 2600);
    return () => { loop.stop(); glow.stop(); breath.stop(); hLoop.stop(); clearInterval(ti); };
  }, [visible, scanMode]);

  // ── Loop AI Vision ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible || scanMode !== 'aiVision') return;
    const oFast = Animated.loop(Animated.timing(orbitFast, { toValue:1, duration:4000, easing:Easing.linear, useNativeDriver:true }));
    const oSlow = Animated.loop(Animated.timing(orbitSlow, { toValue:1, duration:10000, easing:Easing.linear, useNativeDriver:true }));
    const makePulse = (a, delay) => Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(a, { toValue:1, duration:1800, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
      Animated.timing(a, { toValue:0, duration:100, useNativeDriver:true }),
    ]));
    const coreLoop = Animated.loop(Animated.sequence([
      Animated.timing(aiCoreScale,  { toValue:1.08, duration:1000, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
      Animated.timing(aiCoreScale,  { toValue:1,    duration:1000, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
    ]));
    const brightLoop = Animated.loop(Animated.sequence([
      Animated.timing(aiCoreBright, { toValue:1, duration:800, easing:Easing.inOut(Easing.sin), useNativeDriver:false }),
      Animated.timing(aiCoreBright, { toValue:0, duration:800, easing:Easing.inOut(Easing.sin), useNativeDriver:false }),
    ]));
    oFast.start(); oSlow.start();
    makePulse(pulse1, 0).start();
    makePulse(pulse2, 600).start();
    makePulse(pulse3, 1200).start();
    coreLoop.start(); brightLoop.start();
    const ti = setInterval(() => setTipIdx(i => (i+1) % tips.length), 2600);
    return () => { oFast.stop(); oSlow.stop(); coreLoop.stop(); brightLoop.stop(); clearInterval(ti); };
  }, [visible, scanMode]);

  // ── Overlay consultando ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showAchandoGif) { consultAnim.setValue(0); consultProg.setValue(0); return; }
    Animated.timing(consultAnim, { toValue:1, duration:350, easing:Easing.out(Easing.cubic), useNativeDriver:true }).start();
    Animated.timing(consultProg, { toValue:0.82, duration:3200, easing:Easing.out(Easing.quad), useNativeDriver:false }).start();
    const spin = Animated.loop(Animated.timing(consultSpin, { toValue:1, duration:1400, easing:Easing.linear, useNativeDriver:true }));
    spin.start();
    const srcInt = setInterval(() => setSrcIdx(i => (i+1) % SOURCES.length), 1100);
    const dotInt = setInterval(() => setDotCount(i => (i+1) % 4), 380);
    const srcA = Animated.loop(Animated.sequence([
      Animated.timing(srcPulse, { toValue:1.12, duration:550, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
      Animated.timing(srcPulse, { toValue:1,    duration:550, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
    ]));
    srcA.start();
    return () => { spin.stop(); srcA.stop(); clearInterval(srcInt); clearInterval(dotInt); };
  }, [showAchandoGif]);

  const pressTorch = () => {
    Animated.sequence([
      Animated.timing(torchBtnA, { toValue:0.78, duration:70, useNativeDriver:true }),
      Animated.spring(torchBtnA, { toValue:1, tension:260, friction:7, useNativeDriver:true }),
    ]).start();
    setTorchOn(v => !v);
  };

  // ── Derivações ─────────────────────────────────────────────────────────────
  const laserY      = laserAnim.interpolate({ inputRange:[0,1], outputRange:[4, SCAN.BH - 6] });
  const cornerColor = cornerGlow.interpolate({ inputRange:[0,1], outputRange:[acColor+'99', '#FFFFFF'] });
  const spinRot     = consultSpin.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });
  const orbitFastRot= orbitFast.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });
  const orbitSlowRot= orbitSlow.interpolate({ inputRange:[0,1], outputRange:['0deg','-360deg'] });
  const coreBg      = aiCoreBright.interpolate({ inputRange:[0,1], outputRange:[NEON_PURPLE+'22', NEON_VIOLET+'44'] });
  const scanHX      = scanLineX.interpolate({ inputRange:[0,1], outputRange:[-SCAN.BW/2, SCAN.BW/2] });

  const sideW = (SW - SCAN.BW) / 2;
  const sideWAI = (SW - SCAN.AW) / 2;
  const topH  = (SH - (scanMode === 'barcode' ? SCAN.BH : SCAN.AW)) / 2 - 10;

  const DOT_SIZES   = [7, 5, 8, 5, 6];
  const DOT_ANGLES  = [0, 72, 144, 216, 288];
  const DOT_COLORS  = [NEON_PURPLE, '#FFFFFF', NEON_VIOLET, NEON_CYAN, NEON_PURPLE];
  const DOT_RADII   = [SCAN.AW/2 + 10, SCAN.AW/2 + 16, SCAN.AW/2 + 8, SCAN.AW/2 + 18, SCAN.AW/2 + 12];

  return (
    <Modal visible={visible} animationType="none" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex:1, backgroundColor:'#000' }}>

        {/* ── Câmera full-screen ── */}
        <CameraView
          ref={camRef}
          style={StyleSheet.absoluteFill}
          enableTorch={torchOn}
          onBarcodeScanned={scanMode === 'barcode' ? onBarcode : undefined}
          barcodeScannerSettings={{ barcodeTypes:['ean13','upc_a','ean8','qr','code128','itf14'] }}
          onCameraReady={scanMode === 'aiVision' ? onAIVisionCameraReady : undefined}
        />

        {/* ── Vinheta (4 painéis opacos ao redor do visor) ── */}
        {scanMode === 'barcode' && (
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            <View style={{ height: topH, backgroundColor:'rgba(0,0,0,0.80)' }} />
            <View style={{ height: SCAN.BH, flexDirection:'row' }}>
              <View style={{ width: sideW, backgroundColor:'rgba(0,0,0,0.80)' }} />
              <View style={{ width: SCAN.BW }} />
              <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.80)' }} />
            </View>
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.80)' }} />
          </View>
        )}
        {scanMode === 'aiVision' && (
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            <View style={{ height: topH, backgroundColor:'rgba(0,0,0,0.82)' }} />
            <View style={{ height: SCAN.AW, flexDirection:'row' }}>
              <View style={{ width: sideWAI, backgroundColor:'rgba(0,0,0,0.82)' }} />
              <View style={{ width: SCAN.AW, borderRadius: SCAN.AW/2, overflow:'hidden' }}>
                {/* Máscara circular — deixa a câmera visível só no círculo */}
              </View>
              <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.82)' }} />
            </View>
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.82)' }} />
          </View>
        )}

        {/* ════════════════════════════════════════════
             HEADER FLUTUANTE
        ════════════════════════════════════════════ */}
        <Animated.View style={{
          position:'absolute', top:0, left:0, right:0,
          paddingTop: 50, paddingBottom: 16, paddingHorizontal: 18,
          flexDirection:'row', alignItems:'center', justifyContent:'space-between',
          transform:[{ translateY: headerSlide }],
          opacity: mountAnim,
        }}>
          {/* Fechar */}
          <TouchableOpacity onPress={onClose} activeOpacity={0.75} style={{
            width:46, height:46, borderRadius:23,
            backgroundColor:'rgba(255,255,255,0.10)',
            borderWidth:1, borderColor:'rgba(255,255,255,0.20)',
            alignItems:'center', justifyContent:'center',
            shadowColor:'#000', shadowOpacity:0.5, shadowRadius:12,
          }}>
            <Feather name="x" size={20} color="#FFF" />
          </TouchableOpacity>

          {/* Título */}
          <View style={{ alignItems:'center', flex:1, paddingHorizontal:10 }}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:7 }}>
              {/* Ponto de status pulsante */}
              <Animated.View style={{
                width:7, height:7, borderRadius:3.5,
                backgroundColor: acColor,
                shadowColor: acColor, shadowOpacity:1, shadowRadius:8,
                opacity: cornerGlow.interpolate({ inputRange:[0,1], outputRange:[0.5,1] }),
              }} />
              <Text style={{ color:'#FFF', fontWeight:'900', fontSize:15*fontScale, letterSpacing:0.2 }}>
                {scanMode === 'barcode' ? 'Escanear Produto' : 'IA Vision'}
              </Text>
            </View>
            <Text style={{ color: acColor, fontSize:10*fontScale, fontWeight:'700', marginTop:2, letterSpacing:0.5 }}>
              {scanMode === 'barcode' ? 'EAN-13 · EAN-8 · QR · CODE-128' : 'Gemini Flash · Reconhecimento visual'}
            </Text>
          </View>

          {/* Flash */}
          <Animated.View style={{ transform:[{ scale: torchBtnA }] }}>
            <TouchableOpacity onPress={pressTorch} activeOpacity={0.75} style={{
              width:46, height:46, borderRadius:23,
              backgroundColor: torchOn ? '#FCD34D' : 'rgba(255,255,255,0.10)',
              borderWidth:1.5, borderColor: torchOn ? '#FCD34D' : 'rgba(255,255,255,0.20)',
              alignItems:'center', justifyContent:'center',
              shadowColor: torchOn ? '#FCD34D' : 'transparent',
              shadowOpacity: torchOn ? 1 : 0, shadowRadius: torchOn ? 24 : 0, elevation: torchOn ? 14 : 0,
            }}>
              <Feather name={torchOn ? 'zap-off' : 'zap'} size={19} color={torchOn ? '#1A1000' : '#FFF'} />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* ════════════════════════════════════════════
             VIEWFINDER BARCODE
        ════════════════════════════════════════════ */}
        {scanMode === 'barcode' && (
          <Animated.View style={{
            ...StyleSheet.absoluteFillObject,
            alignItems:'center', justifyContent:'center',
            opacity: mountAnim,
          }}>
            {/* Label "Aproxime o código" */}
            <Animated.View style={{
              flexDirection:'row', alignItems:'center', gap:6, marginBottom:18,
              opacity: hintFade,
              transform:[{ translateY: hintFade.interpolate({ inputRange:[0,1], outputRange:[10,0] }) }],
            }}>
              <Feather name="maximize" size={12} color={NEON_BLUE} />
              <Text style={{ color:'rgba(255,255,255,0.75)', fontWeight:'700', fontSize:12*fontScale, letterSpacing:0.5 }}>
                Aproxime o código de barras
              </Text>
            </Animated.View>

            {/* Frame principal animado */}
            <Animated.View style={{ transform:[{ scale: frameBreath }] }}>
              <View style={{
                width: SCAN.BW, height: SCAN.BH,
                alignItems:'center', justifyContent:'center',
                position:'relative',
              }}>
                {/* Fundo do visor com gradiente escuro sutil */}
                <View style={{
                  ...StyleSheet.absoluteFillObject,
                  backgroundColor: NEON_BLUE + '08',
                  borderRadius:4,
                }} />

                {/* Borda animada do frame */}
                <Animated.View style={{
                  ...StyleSheet.absoluteFillObject,
                  borderRadius:4, borderWidth:1,
                  borderColor: cornerGlow.interpolate({
                    inputRange:[0,1], outputRange:[NEON_BLUE+'28', NEON_BLUE+'70'],
                  }),
                }} />

                {/* Cantos */}
                {['TL','TR','BL','BR'].map(p => (
                  <Animated.View key={p} style={{
                    position:'absolute',
                    top: p.includes('T') ? -1 : undefined,
                    bottom: p.includes('B') ? -1 : undefined,
                    left: p.includes('L') ? -1 : undefined,
                    right: p.includes('R') ? -1 : undefined,
                    width: SCAN.CS, height: SCAN.CS,
                    borderTopWidth:    p.includes('T') ? SCAN.CT : 0,
                    borderBottomWidth: p.includes('B') ? SCAN.CT : 0,
                    borderLeftWidth:   p.includes('L') ? SCAN.CT : 0,
                    borderRightWidth:  p.includes('R') ? SCAN.CT : 0,
                    borderTopLeftRadius:     p === 'TL' ? 7 : 0,
                    borderTopRightRadius:    p === 'TR' ? 7 : 0,
                    borderBottomLeftRadius:  p === 'BL' ? 7 : 0,
                    borderBottomRightRadius: p === 'BR' ? 7 : 0,
                    borderColor: cornerColor,
                    shadowColor: acColor, shadowOpacity: 1, shadowRadius: 8,
                  }} />
                ))}

                {/* LASER — linha principal */}
                <Animated.View pointerEvents="none" style={{
                  position:'absolute', left:0, right:0,
                  top: laserY, opacity: laserOpacity,
                }}>
                  {/* Halo superior difuso */}
                  <View style={{ position:'absolute', bottom:2, left:0, right:0, height:30, backgroundColor:NEON_BLUE+'12', borderRadius:15 }} />
                  {/* Halo médio */}
                  <View style={{ position:'absolute', bottom:1, left:'5%', right:'5%', height:12, backgroundColor:NEON_BLUE+'28', borderRadius:6 }} />
                  {/* Núcleo da linha */}
                  <View style={{ height:2, backgroundColor:'#FFFFFF', borderRadius:1, shadowColor:NEON_BLUE, shadowOpacity:1, shadowRadius:10, elevation:10 }} />
                  {/* Reflexo top */}
                  <View style={{ position:'absolute', top:-1, left:'15%', right:'15%', height:1, backgroundColor:NEON_CYAN+'90', borderRadius:1 }} />
                  {/* Handles nas extremidades */}
                  <View style={{ position:'absolute', top:-4, left:-2, width:6, height:10, backgroundColor:NEON_BLUE, borderRadius:3 }} />
                  <View style={{ position:'absolute', top:-4, right:-2, width:6, height:10, backgroundColor:NEON_BLUE, borderRadius:3 }} />
                </Animated.View>

                {/* Linha scan horizontal (cinema) — cruza da esquerda pra direita */}
                <Animated.View pointerEvents="none" style={{
                  position:'absolute', top:0, bottom:0, width:2,
                  backgroundColor: NEON_CYAN+'40',
                  shadowColor: NEON_CYAN, shadowOpacity:0.7, shadowRadius:6,
                  transform:[{ translateX: scanHX }],
                  opacity: laserOpacity,
                }} />

                {/* Grade de alinhamento */}
                <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject }}>
                  {[0.33, 0.66].map((x, i) => (
                    <View key={i} style={{ position:'absolute', left:`${x*100}%`, top:0, bottom:0, width:1, backgroundColor:NEON_BLUE+'12' }} />
                  ))}
                  <View style={{ position:'absolute', top:'50%', left:0, right:0, height:1, backgroundColor:NEON_BLUE+'10' }} />
                </View>
              </View>
            </Animated.View>

            {/* Dica rotativa */}
            <Animated.View style={{ marginTop:20, opacity: hintFade }}>
              <Text style={{ color:'rgba(255,255,255,0.45)', fontSize:11.5*fontScale, fontWeight:'600', textAlign:'center' }}>
                {tips[tipIdx]}
              </Text>
            </Animated.View>

            {/* Fonte label */}
            <View style={{ position:'absolute', bottom:106, left:0, right:0, alignItems:'center', gap:8 }}>
              <View style={{ flexDirection:'row', gap:6 }}>
                {SOURCES.map((s, i) => (
                  <View key={i} style={{
                    flexDirection:'row', alignItems:'center', gap:4,
                    paddingHorizontal:9, paddingVertical:5,
                    backgroundColor:'rgba(255,255,255,0.07)',
                    borderRadius:12, borderWidth:1, borderColor:'rgba(255,255,255,0.12)',
                  }}>
                    <Feather name={s.icon} size={9} color={s.color} />
                    <Text style={{ color:'rgba(255,255,255,0.45)', fontSize:9*fontScale, fontWeight:'700' }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ════════════════════════════════════════════
             VIEWFINDER AI VISION
        ════════════════════════════════════════════ */}
        {scanMode === 'aiVision' && (
          <Animated.View style={{
            ...StyleSheet.absoluteFillObject,
            alignItems:'center', justifyContent:'center',
            opacity: mountAnim,
          }}>
            {/* Container de todos os anéis e partículas */}
            <View style={{ width: SCAN.AW + 80, height: SCAN.AW + 80, alignItems:'center', justifyContent:'center' }}>

              {/* Anéis de pulso */}
              <PulseRing size={SCAN.AW + 50} color={NEON_PURPLE} anim={pulse1} strokeW={1}   />
              <PulseRing size={SCAN.AW + 50} color={NEON_VIOLET} anim={pulse2} strokeW={1.5} />
              <PulseRing size={SCAN.AW + 50} color={NEON_CYAN}   anim={pulse3} strokeW={0.8} />

              {/* Anel externo girando devagar (sentido anti-horário, tracejado) */}
              <Animated.View style={{
                position:'absolute',
                width: SCAN.AW + 48, height: SCAN.AW + 48,
                borderRadius: (SCAN.AW + 48) / 2,
                borderWidth:1, borderColor: NEON_PURPLE+'30',
                borderStyle:'dashed',
                transform:[{ rotate: orbitSlowRot }],
              }} />

              {/* Anel médio girando rápido */}
              <Animated.View style={{
                position:'absolute',
                width: SCAN.AW + 22, height: SCAN.AW + 22,
                borderRadius: (SCAN.AW + 22) / 2,
                borderWidth:2.5, borderColor: NEON_PURPLE,
                borderStyle:'solid',
                shadowColor: NEON_PURPLE, shadowOpacity:0.7, shadowRadius:24, elevation:16,
                transform:[{ rotate: orbitFastRot }],
                // Borda com "abertura" no topo (efeito arco)
                borderTopColor:'transparent', borderTopWidth:2.5,
              }} />

              {/* Partículas orbitando */}
              {DOT_ANGLES.map((angle, i) => (
                <FloatDot
                  key={i}
                  angle={angle} radius={DOT_RADII[i]}
                  size={DOT_SIZES[i]} color={DOT_COLORS[i]}
                  orbitAnim={i % 2 === 0 ? orbitFast : orbitSlow}
                  phase={i}
                />
              ))}

              {/* Anel interno fixo */}
              <View style={{
                position:'absolute',
                width: SCAN.AW - 8, height: SCAN.AW - 8,
                borderRadius: (SCAN.AW - 8) / 2,
                borderWidth:1, borderColor: NEON_PURPLE+'35',
              }} />

              {/* Núcleo: ícone do robô */}
              <Animated.View style={{
                width:96, height:96, borderRadius:48,
                backgroundColor: coreBg,
                borderWidth:2.5, borderColor: NEON_PURPLE,
                alignItems:'center', justifyContent:'center',
                transform:[{ scale: aiCoreScale }],
                shadowColor: NEON_PURPLE, shadowOpacity:0.9, shadowRadius:36, elevation:22,
              }}>
                <MaterialCommunityIcons name="robot-outline" size={44} color={NEON_PURPLE} />
              </Animated.View>
            </View>

            {/* Label abaixo */}
            <Animated.View style={{ marginTop:24, alignItems:'center', opacity: hintFade, gap:6 }}>
              <Text style={{ color:'rgba(255,255,255,0.70)', fontWeight:'800', fontSize:13*fontScale, letterSpacing:0.2 }}>
                IA Vision Ativa
              </Text>
              <Text style={{ color:'rgba(255,255,255,0.38)', fontSize:11*fontScale, fontWeight:'600' }}>
                {tips[tipIdx]}
              </Text>
            </Animated.View>

            {/* Fonte pills */}
            <View style={{ position:'absolute', bottom:106, left:0, right:0, alignItems:'center', gap:8 }}>
              <View style={{ flexDirection:'row', gap:6 }}>
                {SOURCES.map((s, i) => (
                  <View key={i} style={{
                    flexDirection:'row', alignItems:'center', gap:4,
                    paddingHorizontal:9, paddingVertical:5,
                    backgroundColor:'rgba(255,255,255,0.07)',
                    borderRadius:12, borderWidth:1, borderColor:'rgba(255,255,255,0.12)',
                  }}>
                    <Feather name={s.icon} size={9} color={s.color} />
                    <Text style={{ color:'rgba(255,255,255,0.45)', fontSize:9*fontScale, fontWeight:'700' }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ════════════════════════════════════════════
             AVISO AMBIENTE ESCURO
        ════════════════════════════════════════════ */}
        {isDarkEnv && !torchOn && (
          <Animated.View style={{
            position:'absolute', bottom:180, left:20, right:20,
            backgroundColor:'rgba(252,211,77,0.08)',
            borderRadius:18, borderWidth:1.5, borderColor:'rgba(252,211,77,0.35)',
            paddingHorizontal:14, paddingVertical:10,
            flexDirection:'row', alignItems:'center', gap:10,
            opacity: mountAnim,
          }}>
            <Feather name="sun" size={14} color="#FCD34D" />
            <Text style={{ color:'#FCD34D', fontSize:11.5*fontScale, fontWeight:'700', flex:1 }}>
              Ambiente escuro — ative o flash
            </Text>
            <TouchableOpacity onPress={pressTorch} style={{
              paddingHorizontal:11, paddingVertical:5,
              backgroundColor:'rgba(252,211,77,0.18)',
              borderRadius:10, borderWidth:1, borderColor:'rgba(252,211,77,0.35)',
            }}>
              <Text style={{ color:'#FCD34D', fontSize:11*fontScale, fontWeight:'800' }}>Ligar</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ════════════════════════════════════════════
             OVERLAY "CONSULTANDO FONTES"
        ════════════════════════════════════════════ */}
        {showAchandoGif && (
          <Animated.View style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor:'rgba(3,2,16,0.97)',
            alignItems:'center', justifyContent:'center',
            opacity: consultAnim,
            zIndex:999,
          }}>
            {/* Glow de fundo */}
            <View pointerEvents="none" style={{
              position:'absolute',
              width:320, height:320, borderRadius:160,
              backgroundColor: NEON_PURPLE, opacity:0.05,
            }} />
            <View pointerEvents="none" style={{
              position:'absolute',
              width:200, height:200, borderRadius:100,
              backgroundColor: NEON_BLUE, opacity:0.06,
              transform:[{ translateX: 60 }, { translateY: -40 }],
            }} />

            {/* Ícone central girando */}
            <View style={{ position:'relative', width:120, height:120, alignItems:'center', justifyContent:'center', marginBottom:36 }}>
              {/* Anel externo girando */}
              <Animated.View style={{
                position:'absolute', width:118, height:118, borderRadius:59,
                borderWidth:2, borderColor: NEON_PURPLE,
                borderTopColor:'transparent',
                transform:[{ rotate: spinRot }],
                shadowColor: NEON_PURPLE, shadowOpacity:0.8, shadowRadius:20,
              }} />
              {/* Anel interno contra-girando */}
              <Animated.View style={{
                position:'absolute', width:90, height:90, borderRadius:45,
                borderWidth:1.5, borderColor: NEON_CYAN,
                borderBottomColor:'transparent',
                transform:[{ rotate: spinRot.interpolate({ inputRange:[0,1], outputRange:['360deg','0deg'] }) }],
              }} />
              {/* Core do ícone */}
              <View style={{
                width:66, height:66, borderRadius:33,
                backgroundColor: NEON_PURPLE+'1A',
                borderWidth:2, borderColor: NEON_PURPLE+'60',
                alignItems:'center', justifyContent:'center',
                shadowColor: NEON_PURPLE, shadowOpacity:0.9, shadowRadius:28,
              }}>
                <MaterialCommunityIcons name="barcode-scan" size={30} color={NEON_PURPLE} />
              </View>

              {/* Badge fonte ativa */}
              <Animated.View style={{
                position:'absolute', bottom:2, right:2,
                width:32, height:32, borderRadius:11,
                backgroundColor: src.color,
                alignItems:'center', justifyContent:'center',
                borderWidth:2.5, borderColor:'rgba(3,2,16,0.95)',
                shadowColor: src.color, shadowOpacity:0.9, shadowRadius:12,
                transform:[{ scale: srcPulse }],
              }}>
                <Feather name={src.icon} size={13} color="#FFF" />
              </Animated.View>
            </View>

            {/* Texto principal */}
            <Text style={{ color:'#FFF', fontSize:22, fontWeight:'900', letterSpacing:-0.5, marginBottom:4, textAlign:'center' }}>
              Consultando{'.'.repeat(dotCount)}
            </Text>
            <Text style={{ color:'rgba(255,255,255,0.35)', fontSize:12, fontWeight:'600', marginBottom:20, textAlign:'center' }}>
              {src.label}
            </Text>

            {/* Barra de progresso */}
            <ScanProgressBar prog={consultProg} color={NEON_PURPLE} />

            {/* Pills das fontes */}
            <View style={{ flexDirection:'row', gap:8, marginTop:24, flexWrap:'wrap', justifyContent:'center', paddingHorizontal:24 }}>
              {SOURCES.map((s, i) => (
                <Animated.View key={i} style={{
                  flexDirection:'row', alignItems:'center', gap:5,
                  paddingHorizontal: i === srcIdx ? 13 : 9, paddingVertical:7,
                  backgroundColor: i === srcIdx ? s.color+'22' : 'rgba(255,255,255,0.05)',
                  borderRadius:18, borderWidth:1.5,
                  borderColor: i === srcIdx ? s.color+'70' : 'rgba(255,255,255,0.10)',
                  transform:[{ scale: i === srcIdx ? srcPulse : new Animated.Value(1) }],
                }}>
                  <Feather name={s.icon} size={10} color={i === srcIdx ? s.color : 'rgba(255,255,255,0.30)'} />
                  {i === srcIdx && (
                    <Text style={{ color: s.color, fontWeight:'800', fontSize:11, letterSpacing:0.1 }}>{s.label}</Text>
                  )}
                </Animated.View>
              ))}
            </View>

            {/* Rodapé */}
            <Text style={{ color:'rgba(255,255,255,0.18)', fontSize:10.5, fontWeight:'600', marginTop:32, letterSpacing:0.5 }}>
              GEI · PAINEL DE ESTOQUE INTELIGENTE
            </Text>
          </Animated.View>
        )}

      </View>
    </Modal>
  );
};


// ════════════════════════════════════════════════════════════════════════════
//  ROBOBGIF PREMIUM  ─  Substitui o <Modal visible={showRoboGif}> antigo
//  (IA Vision "Produto Identificado" — sem GIF estático, animação pura)
// ════════════════════════════════════════════════════════════════════════════
const RoboGifPremium = ({ roboMsg, T, fontScale }) => {
  const scaleA  = useRef(new Animated.Value(0.55)).current;
  const opacA   = useRef(new Animated.Value(0)).current;
  const checkA  = useRef(new Animated.Value(0)).current;
  const ring1A  = useRef(new Animated.Value(0.7)).current;
  const ring2A  = useRef(new Animated.Value(0.7)).current;
  const textSl  = useRef(new Animated.Value(18)).current;
  const textOp  = useRef(new Animated.Value(0)).current;
  const iconRot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scaleA.setValue(0.55); opacA.setValue(0); checkA.setValue(0);
    ring1A.setValue(0.7); ring2A.setValue(0.7);
    textSl.setValue(18); textOp.setValue(0); iconRot.setValue(0);

    const rotLoop = Animated.loop(
      Animated.timing(iconRot, { toValue:1, duration:3000, easing:Easing.linear, useNativeDriver:true })
    );

    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacA,  { toValue:1, duration:200, useNativeDriver:true }),
        Animated.spring(scaleA, { toValue:1, tension:140, friction:8, useNativeDriver:true }),
      ]),
      Animated.parallel([
        Animated.spring(checkA, { toValue:1, tension:200, friction:7, useNativeDriver:true }),
        Animated.loop(Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1A, { toValue:1.5, duration:900, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
            Animated.timing(ring2A, { toValue:1.75, duration:1100, delay:160, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
          ]),
          Animated.timing(ring1A, { toValue:0.7, duration:0, useNativeDriver:true }),
          Animated.timing(ring2A, { toValue:0.7, duration:0, useNativeDriver:true }),
        ])),
        Animated.timing(textSl, { toValue:0, duration:340, delay:140, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
        Animated.timing(textOp, { toValue:1, duration:300, delay:140, useNativeDriver:true }),
      ]),
    ]).start();
    rotLoop.start();
    return () => rotLoop.stop();
  }, [roboMsg]);

  const green    = '#22C55E';
  const ICSZ     = 96;
  const prodName = String(roboMsg || '').split('\n').slice(1).join(' ').trim();
  const rotDeg   = iconRot.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });

  return (
    <View style={{ flex:1, backgroundColor:'rgba(0,8,24,0.95)', justifyContent:'center', alignItems:'center', paddingHorizontal:24 }}>
      {/* Anéis */}
      {[ring1A, ring2A].map((anim, idx) => (
        <Animated.View key={idx} style={{
          position:'absolute',
          width: ICSZ * (idx===0 ? 2.4 : 3.1),
          height: ICSZ * (idx===0 ? 2.4 : 3.1),
          borderRadius: ICSZ * (idx===0 ? 1.2 : 1.55),
          borderWidth: idx===0 ? 2 : 1.5,
          borderColor: green,
          transform:[{ scale: anim }],
          opacity: anim.interpolate({ inputRange:[0.7,1,idx===0?1.5:1.75], outputRange:[0.5,0.2,0] }),
        }} />
      ))}

      {/* Círculo ícone */}
      <Animated.View style={{
        width:ICSZ, height:ICSZ, borderRadius:ICSZ/2,
        backgroundColor: green+'1A',
        borderWidth:2.5, borderColor:green,
        alignItems:'center', justifyContent:'center',
        transform:[{ scale: scaleA }],
        shadowColor:green, shadowOpacity:0.8, shadowRadius:36, elevation:24,
        opacity: opacA,
      }}>
        <Animated.View style={{ transform:[{ rotate: rotDeg }] }}>
          <MaterialCommunityIcons name="robot-excited-outline" size={46} color={green} />
        </Animated.View>
        {/* Check badge */}
        <Animated.View style={{
          position:'absolute', bottom:-4, right:-4,
          width:28, height:28, borderRadius:14,
          backgroundColor: green,
          alignItems:'center', justifyContent:'center',
          transform:[{ scale: checkA }],
          shadowColor:green, shadowOpacity:0.8, shadowRadius:8, elevation:8,
        }}>
          <Feather name="check" size={14} color="#FFF" />
        </Animated.View>
      </Animated.View>

      {/* Textos */}
      <Animated.View style={{
        marginTop:32, alignItems:'center', paddingHorizontal:20,
        transform:[{ translateY: textSl }],
        opacity: textOp,
      }}>
        {/* Badge "IA Vision" */}
        <View style={{
          flexDirection:'row', alignItems:'center', gap:6,
          backgroundColor:'rgba(79,116,255,0.12)',
          paddingHorizontal:14, paddingVertical:6,
          borderRadius:20, borderWidth:1.5, borderColor:'rgba(79,116,255,0.35)',
          marginBottom:16,
        }}>
          <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#4F74FF' }} />
          <Text style={{ fontSize:11*(fontScale||1), fontWeight:'900', color:'#4F74FF', letterSpacing:1.5, textTransform:'uppercase' }}>
            IA Vision · GEI.AI
          </Text>
        </View>

        {/* Nome do produto */}
        <Text style={{ color:green, fontSize:12*(fontScale||1), fontWeight:'900', letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>
          Produto Identificado!
        </Text>
        <Text style={{
          color:'#FFF', fontSize:17*(fontScale||1), fontWeight:'900',
          textAlign:'center', lineHeight:24,
        }} numberOfLines={3}>
          {prodName || 'Produto identificado com sucesso'}
        </Text>

        {/* Status "abrindo cadastro" */}
        <View style={{
          flexDirection:'row', alignItems:'center', gap:8, marginTop:20,
          backgroundColor: green+'14',
          paddingHorizontal:16, paddingVertical:9,
          borderRadius:20, borderWidth:1.5, borderColor: green+'35',
        }}>
          <Feather name="check-circle" size={14} color={green} />
          <Text style={{ fontSize:12*(fontScale||1), fontWeight:'800', color:green }}>Cadastro sendo aberto...</Text>
        </View>
      </Animated.View>
    </View>
  );
};

export default function App() {
  const [showNotifPermission, setShowNotifPermission] = useState(false);
  const [showScheduledNotifs, setShowScheduledNotifs] = useState(false);
  
  // Lógica para solicitar permissão de forma inteligente
  const checkAndRequestNotif = useCallback(async () => {
    // Se for Web, verifica a Notification API do Chrome
    if (Platform.OS === 'web') {
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          setShowNotifPermission(true);
        }
      }
      return;
    }
    
    // Se for Mobile (Expo), verifica o status atual
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== 'granted') {
      setShowNotifPermission(true);
    }
  }, []);

  const handleConfirmNotif = async () => {
    setShowNotifPermission(false);
    if (Platform.OS === 'web') {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          AppAlert.alert('Sucesso', 'Notificações ativadas no navegador!');
        }
      }
    } else {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        AppAlert.alert('Sucesso', 'Notificações ativadas no dispositivo!');
      }
    }
    await SafeStore.setItemAsync('notif_permission_asked', 'true');
  };

  useEffect(() => {
    if (isLogged) {
      const timer = setTimeout(async () => {
        const asked = await SafeStore.getItemAsync('notif_permission_asked');
        if (!asked) checkAndRequestNotif();
      }, 3000); // Espera 3 segundos após o login para não ser invasivo
      return () => clearTimeout(timer);
    }
  }, [isLogged, checkAndRequestNotif]);

  const [currentTheme, setCurrentTheme] = useState('light');
  const [fontScale, setFontScale] = useState(1);
  const [notifOn, setNotifOn] = useState(true);
  const T = THEMES[currentTheme] || THEMES.dark;
  const [scanning, setScanning] = useState(false);
  const { isDarkEnv, lightLevel } = useDarkEnvironment(scanning);
  const [torchOn, setTorchOn] = useState(false);
  const [erro, setErro] = useState('');
  const showErr = useCallback(m => { setErro(m); setTimeout(() => setErro(''), 6000); }, []);

  const [isLogged, setIsLogged] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [userData, setUserData] = useState(null);
  const [emailIn, setEmailIn] = useState('');
  const [passIn, setPassIn] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qrStep, setQrStep] = useState('role');
  const [qrRole, setQrRole] = useState('Repositor');
  const [showQrGenerator, setShowQrGenerator] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showRastreioModal, setShowRastreioModal] = useState(false);
  const [showAchandoGif, setShowAchandoGif] = useState(false);
  const [showRoboGif, setShowRoboGif] = useState(false);
  const [roboMsg, setRoboMsg] = useState('');
  const gifTimeoutRef = useRef(null);
  const [fifoMode, setFifoMode] = useState(true);
  const [showPainelInteligente, setShowPainelInteligente] = useState(false);
  const [activeShelf, setActiveShelf] = useState('');
  // ── PRATELEIRA FIXADA: quando setada, IA cadastra TUDO aqui (sem deduzir) ──
  const [pinnedShelf, setPinnedShelf] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [estoqueBuilding, setEstoqueBuilding] = useState({ visible: false, produto: '', shelf: '', validade: '' }); // PATCH: overlay 'montando estoque'
  // PATCH: estado do modal "IA pensando" — digita prompts inteligentes ao vivo
  const [smartCadastro, setSmartCadastro] = useState({ visible: false, steps: [], typedSteps: [], produto: null, pergunta: '', promptInterno: '', incoerencias: [], done: false });
  const [shelfModal, setShelfModal] = useState(false);
  const [currentTab, setCurrentTab] = useState('home');
  const [scanMode, setScanMode] = useState('barcode');
  const [prodName, setProdName] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  // ─── "Modal" de progresso "audacioso" do GEI, agora INLINE no chat ────────
  // Em vez de um overlay fullscreen (que fica invisível se o usuário sair da
  // aba de chat), injeta uma mensagem especial (progress: true) na lista de
  // mensagens. Essa mensagem some sozinha quando a análise termina.
  const showJarvisProgress = useCallback((title, steps, onDone) => {
    const id = 'progress-' + Date.now();
    setMsgs(p => [...p, { id, isAi: true, progress: true, progressTitle: title, progressSteps: steps, _onDone: onDone }]);
    return id;
  }, []);
  const closeJarvisProgress = useCallback((id) => {
    setMsgs(p => {
      const found = p.find(m => m.id === id);
      const cb = found && found._onDone;
      const next = p.filter(m => m.id !== id);
      if (typeof cb === 'function') setTimeout(cb, 0);
      return next;
    });
  }, []);

  // ─── IA "audaciosa": detecta possíveis erros do usuário (ex: data inválida,
  // ano passado, formato estranho) e anuncia uma "correção automática" que o
  // usuário pode simplesmente ignorar — reforça a sensação de proatividade.
  const maybeAudaciousCorrection = useCallback((userTxt) => {
    const dateMatch = userTxt.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (!dateMatch) return false;
    let [, dd, mm, yy] = dateMatch;
    if (yy.length === 2) yy = '20' + yy;
    const inputted = `${dd.padStart(2,'0')}/${mm.padStart(2,'0')}/${yy}`;
    const valid = isValidDate(inputted);
    const yearNum = parseInt(yy, 10);
    const nowYear = new Date().getFullYear();
    // Heurística: data inválida OU ano muito no passado (provável digitação errada)
    if (valid && yearNum >= nowYear) return false;

    let corrected = inputted;
    if (!valid) {
      // corrige dia/mes invertidos ou fora do range, mantendo o ano atual minimo
      let d = Math.min(Math.max(parseInt(dd,10) || 1, 1), 28);
      let m = Math.min(Math.max(parseInt(mm,10) || 1, 1), 12);
      let y = yearNum < nowYear ? nowYear : yearNum;
      corrected = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    } else if (yearNum < nowYear) {
      corrected = `${dd.padStart(2,'0')}/${mm.padStart(2,'0')}/${nowYear}`;
    }

    showJarvisProgress(
      'GEI Assistant analisando',
      ['Lendo sua mensagem...', 'Detectando inconsistencia na data...', 'Gerando novo protocolo de data...', 'Corrigindo automaticamente...'],
      () => {
        const note = `Notei que a data "${inputted}" informada parece incorreta. Preparei um novo protocolo de data (${corrected}) e ja corrigi automaticamente no seu pedido. Voce pode ignorar esta mensagem se preferir manter o valor original.`;
        setMsgs(p => [...p, { id: Date.now(), text: note, isAi: true, autoFix: true }]);
      }
    );
    return true;
  }, [showJarvisProgress]);

  // ─── AUTO-PROMPT: a IA "digita" um novo prompt no campo de texto e, apos
  // alguns segundos, envia automaticamente (como se o usuario apertasse
  // Enter). Usado para auto-correcao: se o ultimo pedido falhou ou foi
  // ambiguo, a IA sugere/corrige e ja dispara o reenvio sozinha.
  const autoPromptTimerRef = useRef(null);
  const jarvisAutoPrompt = useCallback((text, delayMs = 3000) => {
    if (autoPromptTimerRef.current) clearTimeout(autoPromptTimerRef.current);
    setChatTxt(text);
    autoPromptTimerRef.current = setTimeout(() => {
      autoPromptTimerRef.current = null;
      // dispara o envio automaticamente, como se o usuario tivesse apertado Enter
      sendChatRef.current && sendChatRef.current();
    }, delayMs);
  }, []);
  // referencia sempre atualizada para sendChat (evita closures presas)
  const sendChatRef = useRef(null);
  useEffect(() => () => { if (autoPromptTimerRef.current) clearTimeout(autoPromptTimerRef.current); }, []);

  // ─── Auto-correcao de prateleira: se a IA nao reconheceu a categoria do
  // produto (ex: "arroz" caiu em macarrao mas usuario queria outra coisa),
  // ela monta um novo prompt mais especifico, mostra o progresso e reenvia
  // automaticamente apos 3s — o usuario pode digitar antes para cancelar.
  const jarvisSuggestRetry = useCallback((originalTxt, hint) => {
    showJarvisProgress(
      'GEI Assistant corrigindo',
      ['Revisando sua solicitacao...', 'Reclassificando produto na prateleira correta...', 'Montando novo prompt...', 'Reenviando automaticamente...'],
      () => {
        const note = `Notei que "${originalTxt}" pode ter sido mal interpretado. Preparei um novo prompt (${hint}) e vou reenviar automaticamente em 3 segundos. Voce pode ignorar esta mensagem ou digitar algo novo para cancelar.`;
        setMsgs(p => [...p, { id: Date.now(), text: note, isAi: true, autoFix: true }]);
        jarvisAutoPrompt(hint, 3000);
      }
    );
  }, [showJarvisProgress, jarvisAutoPrompt]);
  // ── JARVIS global voice state ──────────────────────────────────────────────
  const [jarvisVoiceMode, setJarvisVoiceMode] = useState(false);
  const [jarvisRecording, setJarvisRecording] = useState(false);
  const [jarvisProcessing, setJarvisProcessing] = useState(false);
  const jarvisLiveRef = useRef(false);
  const jarvisLoopTimer = useRef(null);
  const jarvisFailCountRef = useRef(0);
  const jarvisNagCountRef = useRef(0);
  const jarvisLastAddedRef = useRef(null); // ultimo produto cadastrado automaticamente pela IA
  const jarvisWaveAnims = useRef([...Array(5)].map(() => new Animated.Value(0.3))).current;
  const [jarvisConfirmModal, setJarvisConfirmModal] = useState(null); // { nome, validade, prateleira }
  const jarvisConfirmModalRef = useRef(null);
  useEffect(() => { jarvisConfirmModalRef.current = jarvisConfirmModal; }, [jarvisConfirmModal]);
  const jarvisConfirmarCadastro = async () => {
    if (!jarvisConfirmModal) return;
    const { nome, validade, prateleira } = jarvisConfirmModal;
    const shelf = prateleira || activeShelf;
    const tid = SHELVES[shelf] || SHELVES[activeShelf];
    setJarvisConfirmModal(null);
    if (!tid) { speakWithElevenLabs('Prateleira nao encontrada.', () => {}); return; }
    try {
      const dataEnvio = new Date().toLocaleDateString('pt-BR');
      await secureAxiosInstance.post(
        'https://api.baserow.io/api/database/rows/table/' + tid + '/?user_field_names=true',
        { produto: nome, codig: 'Sem EAN', VENCIMENTO: validade, quantidade: '0',
          ENVIADOPORQUEM: (userData && userData.NOME) || 'GEI', PERFILFOTOURL: (userData && userData.PERFILFOTOURL) || '',
          BOLETIM: false, DATAENVIO: dataEnvio, ALERTAMENSAGEM: '', MARGEM: 'Medio giro',
          PREVISAO: calculatePrevisao(0, 'Medio giro', dataEnvio) }
      );
      await addAuditLog('JARVIS_ADD', nome + ' via GEI JARVIS', userData && userData.id);
      if (shelf === activeShelf) loadStock(activeShelf);
      const ok = 'Perfeito. ' + nome + ' cadastrado com validade ' + validade + '.';
      setMsgs(p => [...p, { id: Date.now(), text: ok, isAi: true }]);
      // ── Fecha o painel e exibe o overlay de sucesso ──────────────────────
      setShowPainelInteligente(false);
      setJarvisVoiceMode(false);
      setTimeout(() => setShowSuccess(true), 320); // aguarda animação de saída do modal
      speakWithElevenLabs(ok, () => { if (jarvisLiveRef.liveOn && !jarvisLiveRef.current) { jarvisLiveRef.current = true; jarvisRecordChunk(); } });
    } catch { speakWithElevenLabs('Erro ao salvar. Tente novamente.', () => {}); }
  };
  const jarvisCancelarCadastro = () => {
    setJarvisConfirmModal(null);
    speakWithElevenLabs('Cancelado.', () => { if (jarvisLiveRef.liveOn && !jarvisLiveRef.current) { jarvisLiveRef.current = true; jarvisRecordChunk(); } });
  };
  const [busyMsg, setBusyMsg] = useState('');
  const [wStep, setWStep] = useState(1);
  const [cadastroShelf, setCadastroShelf] = useState('');
  const [validade, setValidade] = useState('');
  const [qtd, setQtd] = useState('');
  const [giro, setGiro] = useState('');
  const [chatTxt, setChatTxt] = useState('');
  const [msgs, setMsgs] = useState([{ id: 1, text: 'Olá! Sou o GEI Assistant 👋\n\nPosso conversar sobre o estoque e também cadastrar produtos direto pelo chat. É só falar naturalmente, tipo:\n\n"Coloca uma Coca-Cola 600ml com validade 15/03/2026"\n"Quais produtos vão vencer essa semana?"\n\nComo posso te ajudar?', isAi: true }]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [currentSources, setCurrentSources] = useState([]);
  const [notFoundModal, setNotFoundModal] = useState({ visible: false, ean: '' });
  const [scannedEAN, setScannedEAN] = useState('');
  const [cleanToast, setCleanToast] = useState(null);
  const [showPinhasModal, setShowPinhasModal] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState({ logs: [], loginHistory: [] });
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [voiceAssistantVisible, setVoiceAssistantVisible] = useState(false);
  const [jarvisInitialTab, setJarvisInitialTab] = useState('chat');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceIndicatorVisible, setVoiceIndicatorVisible] = useState(true);
  
  // ── Configurações de Microfone ────────────────────────────────────────────
  const [micSoundEnabled, setMicSoundEnabled] = useState(true);
  const [micVibrationEnabled, setMicVibrationEnabled] = useState(true);
  const [micSoundVolume, setMicSoundVolume] = useState(1.0); // 0.0 a 1.0
  const [elevenLabsQuota, setElevenLabsQuota] = useState(null);
  const [voiceRecognitionEnabled, setVoiceRecognitionEnabled] = useState(true);

  // Persistência de configurações de microfone
  useEffect(() => {
    const loadMicSettings = async () => {
      const s = await SafeStore.getItemAsync('micSoundEnabled');
      if (s !== null) setMicSoundEnabled(s === 'true');
      const v = await SafeStore.getItemAsync('micVibrationEnabled');
      if (v !== null) setMicVibrationEnabled(v === 'true');
      // Sincroniza refs globais usadas por playListenBeep/playAudioR
      setGlobalMicSettings(
        s !== null ? s === 'true' : true,
        v !== null ? v === 'true' : true,
        vol !== null ? parseFloat(vol) : 1.0
      );
      const vol = await SafeStore.getItemAsync('micSoundVolume');
      if (vol !== null) setMicSoundVolume(parseFloat(vol));
      const vr = await SafeStore.getItemAsync('voiceRecognitionEnabled');
      if (vr !== null) setVoiceRecognitionEnabled(vr === 'true');
    };
    loadMicSettings();
  }, []);

  const updateMicSound = async (val) => {
    setMicSoundEnabled(val);
    await SafeStore.setItemAsync('micSoundEnabled', String(val));
    setGlobalMicSettings(val, micVibrationEnabled, micSoundVolume);
  };
  const updateMicVibration = async (val) => {
    setMicVibrationEnabled(val);
    await SafeStore.setItemAsync('micVibrationEnabled', String(val));
    setGlobalMicSettings(micSoundEnabled, val, micSoundVolume);
  };
  const updateMicVolume = async (val) => {
    setMicSoundVolume(val);
    await SafeStore.setItemAsync('micSoundVolume', String(val));
    setGlobalMicSettings(micSoundEnabled, micVibrationEnabled, val);
  };
  const updateVoiceRecognition = async (val) => { setVoiceRecognitionEnabled(val); await SafeStore.setItemAsync('voiceRecognitionEnabled', String(val)); };


  const hideVoiceIndicator = useCallback(async () => {
    setVoiceIndicatorVisible(false);
    try { await SafeStore.setItemAsync('voiceIndicatorHidden', 'true'); } catch { /* noop */ }
  }, []);

  // ── Escuta sempre ativa — wake word de qualquer tela ──────────────────────
  const [openedByWakeWord, setOpenedByWakeWord] = useState(false);
  const [openedByLembrete, setOpenedByLembrete] = useState(false);
  const openVoiceAssistant = useCallback(() => {
    setOpenedByWakeWord(true);
    setOpenedByLembrete(false);
    setVoiceAssistantVisible(true);
  }, []);
  const openNovidadesAssistant = useCallback(() => {
    setJarvisInitialTab('novidades');
    setShowPainelInteligente(true);
  }, []);
  // Abre o VoiceAssistant JÁ no fluxo de lembrete (pula wake word, vai direto pra LEM_TEXTO)
  const openLembreteAssistant = useCallback(() => {
    setOpenedByWakeWord(false);
    setOpenedByLembrete(true);
    setVoiceAssistantVisible(true);
  }, []);
  // Abre a calculadora de pinhas por voz
  const openCalculadoraAssistant = useCallback(() => {
    setShowPinhasModal(true);
  }, []);
  // Abre o Painel do JARVIS (Painel Inteligente) E já ativa o microfone do JARVIS
  // por voz, sem precisar de nenhum clique. Evita conflito de microfone:
  // o wake-word listener fica desabilitado (enabled=false abaixo) enquanto
  // o Painel/JARVIS estiverem ativos, então só o mic do JARVIS roda.
  const openJarvisAssistant = useCallback(() => {
    setJarvisInitialTab('chat');
    setShowPainelInteligente(true);
    setJarvisVoiceMode(true);
  }, []);
  const { isAlwaysListening } = useAlwaysOnWakeWord({
    enabled: isLogged && !voiceAssistantVisible && !showPinhasModal && !showPainelInteligente && !jarvisVoiceMode && voiceRecognitionEnabled,
    onWakeWord: openVoiceAssistant,
    onNovidadesWord: openNovidadesAssistant,
    onLembreteWord: openLembreteAssistant,
    onCalculadoraWord: openCalculadoraAssistant,
    onJarvisWord: openJarvisAssistant,
  });

  const handleStartScanning = async (mode = 'barcode') => {
    const { status } = await Camera.getCameraPermissionsAsync();
    if (status !== 'granted') {
      const { status: newStatus } = await Camera.requestCameraPermissionsAsync();
      if (newStatus !== 'granted') {
        AppAlert.alert('Permissão Necessária', 'O GEI.AI precisa de acesso à câmera para ler códigos de barras.');
        return;
      }
    }
    setScanMode(mode);
    setScanning(true);
  };


  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef();
  const camRef = useRef(null);
  const lastScan = useRef(Date.now());

  const GIRO = useMemo(() => makeGiro(T), [T]);
  const perf = userData?.PERFIL || '';
  const canSw = canSwitch(perf);
  const initials = getInitials(userData?.NOME || 'Usuário');
  const shPal = shelfPalette(T, activeShelf || 'bebida');
  const TAB_H = 70, TAB_SAFE = TAB_H + NAV_BAR_H;
  const fcol = { blue: T.blue, green: T.green, amber: T.amber, red: T.red };

  useEffect(() => { const hide = () => { StatusBar.setHidden(true, 'none'); StatusBar.setTranslucent(true); StatusBar.setBackgroundColor('transparent', false); }; hide(); const sub = AppState.addEventListener('change', s => { if (s === 'active') hide(); }); return () => sub.remove(); }, []);
  useEffect(() => { if (Platform.OS === 'android') { NavigationBar.setVisibilityAsync('hidden').catch(() => {}); NavigationBar.setBackgroundColorAsync('transparent').catch(() => {}); } }, []);
  // OneSignal: inicializa ao montar e configura callback de navegação
  useEffect(() => {
    initOneSignal();
    setOneSignalNavCallback((shelf) => {
      if (shelf && SHELVES[shelf]) {
        setActiveShelf(shelf);
        setCurrentTab('estoque');
      }
    });
  }, []);
  useEffect(() => { if (scanning && scanMode === 'barcode') { Animated.loop(Animated.sequence([Animated.timing(scanAnim, { toValue: 1, duration: 2000, useNativeDriver: false }), Animated.timing(scanAnim, { toValue: 0, duration: 2000, useNativeDriver: false })])).start(); } else scanAnim.setValue(0); }, [scanning, scanMode, scanAnim]);
  useEffect(() => { if (scanning && scanMode === 'aiVision') { Animated.loop(Animated.sequence([Animated.timing(pulseAnim, { toValue: 1.07, duration: 800, useNativeDriver: false }), Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false })])).start(); } else pulseAnim.setValue(1); }, [scanning, scanMode, pulseAnim]);

  // Define captureVision antes de usá-lo em onAIVisionCameraReady
  const captureVision = useCallback(async () => {
    if (!camRef.current) { showErr('Câmera não iniciada.'); return; }
    setCountdown(null); setBusy(true); setBusyMsg('IA Vision analisando imagem...');
    try {
      const foto = await camRef.current.takePictureAsync({ base64: true, quality: 0.88, exif: false });
      if (!foto?.base64) { throw new Error('Foto não capturada corretamente'); }
      const visionPrompt = 
        "Você é um especialista sênior em produtos de supermercado brasileiro. " +
        "Analise DETALHADAMENTE esta embalagem: examine rótulo, logotipo, código EAN, " +
        "peso/volume, sabor, variante e todos os textos visíveis. " +
        "Use conhecimento sobre marcas brasileiras (Nestlé, Unilever, BRF, JBS, Ambev, " +
        "Coca-Cola, Pepsico, Mondelez, Camil, etc.). " +
        "Retorne APENAS JSON válido sem markdown: " +
        '{"descricao":"nome comercial completo","marca":"fabricante exato",' +
        '"tipo":"subcategoria específica","gramatura":"peso ou volume com unidade",' +
        '"rotatividade":"Grande giro"|"Médio giro"|"Pouco giro",' +
        '"detalhes":"sabor, variante ou info extra"}';
      let resultText = '';
      if (RT_API_KEY_IA) {
        const visionModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        for (const vModel of visionModels) {
          try {
            const r = await fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/${vModel}:generateContent?key=${RT_API_KEY_IA}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [
                      { text: visionPrompt },
                      { inline_data: { mime_type: 'image/jpeg', data: foto.base64 } }
                    ]
                  }],
                  generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
                })
              },
              10000
            );
            if (r.ok) {
              const d = await r.json();
              const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (txt) { resultText = txt; console.log(`[Vision] Gemini ${vModel} OK`); break; }
            } else {
              const errMsg = await parseApiError(r);
              console.warn(`[Vision] Gemini ${vModel} falhou: ${errMsg}`);
              if (r.status === 429 || r.status === 503) { await sleep(300); continue; }
              break;
            }
          } catch (geminiErr) { console.warn(`[Vision] Gemini ${vModel} erro:`, geminiErr.message); }
        }
      }
      if (!resultText && GROQ_API_KEY) {
        const groqVisionModels = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llava-v1.5-7b-4096-preview'];
        for (const gModel of groqVisionModels) {
          try {
            const r = await fetchWithTimeout(
              'https://api.groq.com/openai/v1/chat/completions',
              {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: gModel,
                  messages: [{
                    role: 'user',
                    content: [
                      { type: 'text', text: `Analise esta embalagem de produto de supermercado brasileiro. ${visionPrompt}` },
                      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${foto.base64}` } }
                    ]
                  }],
                  temperature: 0.05,
                  max_tokens: 512
                })
              },
              28000
            );
            if (r.ok) {
              const d = await r.json();
              const txt = d.choices?.[0]?.message?.content || '';
              if (txt) { resultText = txt; console.log(`[Vision] Groq ${gModel} OK`); break; }
            } else {
              const errMsg = await parseApiError(r);
              console.warn(`[Vision] Groq ${gModel} falhou: ${errMsg}`);
              if (r.status === 429) { await sleep(400); continue; }
              break;
            }
          } catch (groqErr) { console.warn(`[Vision] Groq ${gModel} erro:`, groqErr.message); }
        }
      }
      let r = { descricao: 'Produto Indefinido', marca: '', rotatividade: 'Médio giro' };
      if (resultText) {
        try {
          const clean = resultText.replace(/```json|```/g, '').trim();
          const match = clean.match(/\{[\s\S]*\}/);
          if (match) r = JSON.parse(match[0]);
        } catch { console.warn('[Vision] Falha ao parsear JSON:', resultText); }
      } else {
        showErr('IA Vision não conseguiu identificar o produto. Tente novamente com melhor iluminação.');
      }
      const nome = ([r.descricao, r.marca, r.tipo].filter(Boolean).join(' · ') + (r.gramatura ? ` (${r.gramatura})` : '')).toUpperCase();
      setBusy(false);
      setScanning(false);
      setRoboMsg(`Encontrei!\n${nome.trim()}`);
      setShowRoboGif(true);
      setTimeout(() => { setProdName(nome.trim()); setGiro(r.rotatividade || 'Médio giro'); resetWiz(); }, 80);
      setTimeout(() => { setShowRoboGif(false); navTo('cadastro'); }, 1600);
    } catch (ex) {
      showErr(`Erro na análise visual: ${ex.message}`);
      setScanning(false); setBusy(false);
    }
  }, [showErr, setBusy, setBusyMsg, setCountdown, setScanning, setRoboMsg, setShowRoboGif, setProdName, setGiro, resetWiz, navTo]);

  const aiVisionTriggeredRef = useRef(false);
  const onAIVisionCameraReady = useCallback(() => { if (aiVisionTriggeredRef.current) return; aiVisionTriggeredRef.current = true; setTimeout(() => { captureVision(); }, 1200); }, [captureVision]);

  const sortProductsByDate = (products) => { return [...products].sort((a, b) => { const dateA = parseDate(a.DATAENVIO); const dateB = parseDate(b.DATAENVIO); if (!dateA && !dateB) return 0; if (!dateA) return 1; if (!dateB) return -1; return dateB - dateA; }); };
  const filteredStock = useMemo(() => {
    const base = stockData.filter(i => String(i.produto || '').trim() || (String(i.codig || '').trim() && String(i.codig || '') !== 'Sem EAN'));
    let filtered = activeFilter === 'all' ? base : base.filter(i => vencStatus(i.VENCIMENTO).status === activeFilter);
    if (searchQuery.trim()) { const q = searchQuery.trim().toLowerCase(); filtered = filtered.filter(i => String(i.produto || '').toLowerCase().includes(q)); }
    return sortProductsByDate(filtered);
  }, [stockData, activeFilter, searchQuery]);
  const counts = useMemo(() => { const base = stockData.filter(i => String(i.produto || '').trim() || (String(i.codig || '').trim() && String(i.codig || '') !== 'Sem EAN')); return { all: base.length, ok: base.filter(i => vencStatus(i.VENCIMENTO).status === 'ok').length, warning30: base.filter(i => vencStatus(i.VENCIMENTO).status === 'warning30').length, warning: base.filter(i => vencStatus(i.VENCIMENTO).status === 'warning').length, expired: base.filter(i => vencStatus(i.VENCIMENTO).status === 'expired').length }; }, [stockData]);
  const triggerAutoClean = useCallback(async () => { setCleanToast({ cleaning: true }); try { const deleted = await runAutoClean(); if (deleted.length > 0 && activeShelf) loadStock(activeShelf); setCleanToast({ cleaning: false, deleted }); await addAuditLog('AUTO_CLEAN', `${deleted.length} produtos removidos`, userData?.id); } catch (_) { setCleanToast({ cleaning: false, deleted: [] }); } }, [activeShelf, userData, loadStock]);
  const loadStock = useCallback(async shelf => { const tid = SHELVES[shelf]; if (!tid) return; try { const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/${tid}/?user_field_names=true&size=200`); const products = res.data.results || []; setStockData(prev => { /* PATCH: preserva itens otimistas (temp-*) SOMENTE se forem da MESMA prateleira que está sendo recarregada — evita misturar estoque de prateleiras diferentes ao trocar de prateleira */ const serverIds = new Set(products.map(p => p.id)); const now = Date.now(); const localOnly = (prev || []).filter(p => { const sameShelf = p._shelf === shelf; if (!sameShelf) return false; /* item de outra prateleira nunca é preservado */ const isTemp = String(p.id || '').startsWith('temp-'); const isMissingFromServer = !serverIds.has(p.id); if (!isTemp && !isMissingFromServer) return false; const fresh = !p._localTs || (now - p._localTs) < 30000; return fresh; }); const tagged = products.map(p => ({ ...p, _shelf: shelf })); return sortProductsByDate([...localOnly, ...tagged]); }); agendarTercaSemanal(products).catch(()=>{}); verificarTercaHoje(products).catch(()=>{}); verificarRupturaHoje(products, fifoMode, shelf, shlabel(shelf)).catch(()=>{}); } catch (ex) { showErr('Erro ao carregar dados da prateleira.'); } }, [showErr, fifoMode]);

  // ── Auto-atualização do estoque a cada 8 segundos ──────────────────────────
  // Mantém a lista sempre sincronizada com o Baserow sem precisar de ação manual.
  // Pausa quando o app vai para background (economiza dados/bateria) e retoma
  // imediatamente ao voltar ao foreground. Roda silenciosamente (sem loaders).
  const stockPollRef = useRef(null);
  const appStateForPollRef = useRef(AppState.currentState);
  useEffect(() => {
    const tick = () => {
      if (appStateForPollRef.current !== 'active') return;
      const shelfToPoll = activeShelf;
      if (isLogged && shelfToPoll) loadStock(shelfToPoll);
    };
    if (stockPollRef.current) clearInterval(stockPollRef.current);
    if (isLogged && activeShelf) {
      stockPollRef.current = setInterval(tick, 8000);
    }
    return () => { if (stockPollRef.current) clearInterval(stockPollRef.current); };
  }, [isLogged, activeShelf, loadStock]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      const wasBackground = appStateForPollRef.current !== 'active';
      appStateForPollRef.current = s;
      // ✅ ao retornar do background, força uma atualização imediata (não espera os 8s)
      if (s === 'active' && wasBackground && isLogged && activeShelf) loadStock(activeShelf);
    });
    return () => sub.remove();
  }, [isLogged, activeShelf, loadStock]);

  // ── Auto-ativa FIFO quando detecta ≥4 produtos com mesmo nome OU ≥2 com mesmo EAN ──
  React.useEffect(() => {
    if (!stockData || stockData.length === 0) return;
    const { hasFifo } = detectFifoGroups(stockData);
    if (hasFifo) setFifoMode(true);
  }, [stockData]);
  const deleteProduct = useCallback(async (product) => { if (!product?.id) return; const tableId = SHELVES[activeShelf]; if (!tableId) { showErr('Nenhuma prateleira ativa para apagar o produto.'); return; } setBusy(true); setBusyMsg('Apagando produto...'); try { await secureAxiosInstance.delete(`https://api.baserow.io/api/database/rows/table/${tableId}/${product.id}/`); await addAuditLog('PRODUCT_DELETED', `Produto "${product.produto}" apagado da prateleira ${activeShelf}`, userData?.id); setStockData(prev => sortProductsByDate(prev.filter(p => p.id !== product.id))); } catch (ex) { showErr('Não foi possível apagar o produto. Verifique a conexão.'); } finally { setBusy(false); } }, [activeShelf, showErr, userData]);

  // ── Atualizar quantidade do produto (botão "+ Adicionar Quantidade" no detalhe) ──
  // Soma `addQty` à quantidade atual e salva no Baserow via PATCH. Atualização
  // otimista no stockData local para refletir na tela na hora, sem esperar o
  // próximo ciclo do polling de 8s.
  const updateProductQuantity = useCallback(async (product, addQty) => {
    if (!product?.id || !addQty || addQty <= 0) return;
    const tableId = SHELVES[activeShelf];
    if (!tableId) { showErr('Nenhuma prateleira ativa para atualizar a quantidade.'); return; }
    const currentQty = Math.max(0, parseInt(product.quantidade, 10) || 0);
    const newQty = currentQty + addQty;
    setBusy(true); setBusyMsg('Atualizando quantidade...');
    try {
      const novaDataEnvio = new Date().toLocaleDateString('pt-BR');
      const novaPrevisao = calculatePrevisao(newQty, product.MARGEM || 'Medio giro', novaDataEnvio);
      await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/${tableId}/${product.id}/?user_field_names=true`, { quantidade: String(newQty), DATAENVIO: novaDataEnvio, PREVISAO: novaPrevisao });
      await addAuditLog('PRODUCT_QTY_UPDATED', `Quantidade de "${product.produto}" alterada de ${currentQty} para ${newQty} (+${addQty}) na prateleira ${activeShelf}`, userData?.id);
      setStockData(prev => sortProductsByDate(prev.map(p => p.id === product.id ? { ...p, quantidade: String(newQty), DATAENVIO: novaDataEnvio, PREVISAO: novaPrevisao } : p)));
    } catch (ex) {
      showErr('Não foi possível atualizar a quantidade. Verifique a conexão.');
    } finally {
      setBusy(false);
    }
  }, [activeShelf, showErr, userData]);

  const updateLastLogin = async (userId) => { try { const now = new Date(); const novoLogin = { data: now.toLocaleDateString('pt-BR'), hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), iso: now.toISOString() }; let historicoAtual = []; try { const resUser = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/${userId}/?user_field_names=true`); const utimologin = resUser.data?.UTIMOLOGIN || ''; if (utimologin.startsWith('[')) { historicoAtual = JSON.parse(utimologin); } else if (utimologin) { historicoAtual = [{ data: utimologin, hora: '', iso: '' }]; } } catch (_) { historicoAtual = []; } const historicoAtualizado = [novoLogin, ...historicoAtual].slice(0, 3); await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${userId}/?user_field_names=true`, { UTIMOLOGIN: JSON.stringify(historicoAtualizado) }); } catch (error) { console.warn('Nao foi possivel atualizar ultimo login', error); } };
  const handleChangePassword = async (currentPass, newPass) => { if (!userData) return false; try { const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`); const user = res.data.results.find(u => u.id === userData.id); if (!user || user.SENHA !== currentPass) { AppAlert.alert('Erro', 'Senha atual incorreta.'); return false; } await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${userData.id}/?user_field_names=true`, { SENHA: newPass }); await addAuditLog('PASSWORD_CHANGED', 'Senha alterada com sucesso', userData.id); AppAlert.alert('Sucesso', 'Sua senha foi alterada.'); return true; } catch (error) { AppAlert.alert('Erro', 'Não foi possível alterar a senha. Tente novamente.'); return false; } };
  const onBarcode = async ({ data }) => { if (Date.now() - lastScan.current < 500) return; lastScan.current = Date.now(); if (gifTimeoutRef.current) clearTimeout(gifTimeoutRef.current); setScanning(false); setShowAchandoGif(true);     setScannedEAN(data);
    try {
      const sources = await fetchProductSources(data);
      setShowAchandoGif(false);

      const successSources = (sources || []).filter(s => s.status === 'success' && s.nome && !s.nome.startsWith('Falha'));
      if (!successSources || successSources.length === 0) {
        setNotFoundModal({ visible: true, ean: data });
        setCurrentSources([]);
        setSourceModalVisible(false);
      } else if (successSources.length === 1) {
        // Só uma fonte com sucesso — seleciona automaticamente
        onSourceSelected(successSources[0]);
      } else {
        // Várias fontes com sucesso — verifica similaridade entre elas
        const iaSource = successSources.find(s => s.source === 'ia');
        const mainSource = iaSource || successSources[0];
        let bestMatch = mainSource;
        let maxSimilarity = 0;
        for (const src of successSources) {
          if (src === mainSource) continue;
          const sim = stringSimilarity(mainSource.nome, src.nome);
          if (sim > maxSimilarity) { maxSimilarity = sim; bestMatch = src; }
        }
        if (maxSimilarity >= 0.75) {
          // Nomes muito parecidos — usa a da IA (mais refinada) automaticamente
          onSourceSelected(iaSource || mainSource);
        } else {
          // Nomes divergem — mostra modal para usuário escolher
          setCurrentSources(successSources);
          setSourceModalVisible(true);
        }
      }
    } catch (ex) {
      setShowAchandoGif(false);
      setNotFoundModal({ visible: true, ean: data || '' });
    }
  };
  const onSourceSelected = ({ nome }) => { setProdName(nome); setSourceModalVisible(false); setCurrentSources([]); navTo('cadastro'); };
  const doLogin = async (e, p, useBiometrics = false) => { if (lockedOut) { showErr(`Muitas tentativas. Aguarde ${lockoutRemaining}s para tentar novamente.`); return; } if (useBiometrics && biometricEnabled) { const bioAuth = await authenticateWithBiometrics(); if (!bioAuth.success) { showErr('Falha na autenticação biométrica.'); return; } const bioToken = await SafeStore.getItemAsync('bio_token'); if (!bioToken) { showErr('Nenhum token biométrico salvo. Faça login normal primeiro.'); return; } try { const resB = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`); const bioUser = resB.data.results.find(u => u.TOKEN_BIOMETRICO === bioToken && u.ACESSO); if (!bioUser) { showErr('Token biométrico inválido ou acesso revogado. Faça login normal.'); return; } await addAuditLog('BIOMETRIC_LOGIN_SUCCESS', `Login biométrico bem-sucedido`, bioUser.id); await updateLastLogin(bioUser.id); onOk(bioUser); return; } catch { showErr('Erro ao validar biometria. Verifique a conexão.'); return; } } if (!e || !p) { showErr('Preencha e-mail e senha.'); return; } if (!isValidEmail(e)) { showErr('E-mail inválido. Use um formato válido como usuario@exemplo.com'); return; } const sanitizedEmail = sanitizeInput(e); const sanitizedPass = sanitizeInput(p); if (sanitizedEmail !== e || sanitizedPass !== p) { showErr('Caracteres inválidos detectados.'); await addAuditLog('LOGIN_INVALID_CHARS', `Tentativa com caracteres inválidos`, null); return; } setLoading(true); setErro(''); try { const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`); const user = res.data.results.find(u => u.USUARIO === sanitizedEmail && u.SENHA === sanitizedPass); if (!user) { const newAttempts = failedAttempts + 1; setFailedAttempts(newAttempts); const remaining = MAX_LOGIN_ATTEMPTS - newAttempts; await addAuditLog('LOGIN_FAILED', `Tentativa ${newAttempts}/${MAX_LOGIN_ATTEMPTS} para ${sanitizedEmail}`, null); if (newAttempts >= MAX_LOGIN_ATTEMPTS) { startLockout(); showErr(`Acesso bloqueado por ${LOCKOUT_SECS} segundos após ${MAX_LOGIN_ATTEMPTS} tentativas incorretas.`); } else { showErr(`E-mail ou senha incorretos. ${remaining} tentativa${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.`); } return; } if (!user.ACESSO) { showErr('Seu acesso não foi liberado pelo coordenador.'); await addAuditLog('LOGIN_ACCESS_DENIED', `Acesso negado para ${sanitizedEmail}`, user.id); return; } setFailedAttempts(0); if (biometricEnabled) { try { const bioToken = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${user.USUARIO}-${Date.now()}-${Math.random()}`); await SafeStore.setItemAsync('bio_token', bioToken); await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${user.id}/?user_field_names=true`, { TOKEN_BIOMETRICO: bioToken }); } catch (_) { /* noop */ } } await addAuditLog('LOGIN_SUCCESS', `Login bem-sucedido`, user.id); await updateLastLogin(user.id); onOk(user); } catch (ex) { showErr('Falha na conexão com o banco de dados.'); await addAuditLog('LOGIN_ERROR', `Erro de conexão: ${ex.message}`, null); } finally { setLoading(false); } };
  const onQR = async ({ data }) => { if (!data) return; try { const payload = JSON.parse(data); if (!payload.usuario || !payload.loginRapido || !payload.timestamp || !payload.expiraEm) { showErr('QR Code inválido ou corrompido.'); await addAuditLog('QR_INVALID', 'QR Code inválido', null); return; } if (Date.now() > payload.expiraEm) { showErr('QR Code expirado. Gere um novo.'); await addAuditLog('QR_EXPIRED', 'QR Code expirado', null); return; } const res = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/?user_field_names=true`); const user = res.data.results.find(u => u.USUARIO === payload.usuario); if (!user) { showErr('Usuário não encontrado.'); await addAuditLog('QR_USER_NOT_FOUND', `Usuário ${payload.usuario} não encontrado`, null); return; } if (user.LOGINRAPIDO !== payload.loginRapido) { showErr('QR Code inválido - código de acesso não corresponde.'); await addAuditLog('QR_MISMATCH', `LOGINRAPIDO não confere para ${payload.usuario}`, user.id); return; } if (!user.ACESSO) { showErr('Seu acesso não foi liberado pelo coordenador.'); await addAuditLog('QR_ACCESS_DENIED', `Acesso negado para ${payload.usuario} via QR`, user.id); return; } user.PERFIL = qrRole; await addAuditLog('QR_LOGIN_SUCCESS', `Login via QR bem-sucedido para ${payload.usuario}`, user.id); await updateLastLogin(user.id); onOk(user); } catch (e) { showErr('QR Code inválido.'); await addAuditLog('QR_ERROR', `Erro ao processar QR: ${e.message}`, null); } };
  const onOk = useCallback(user => { setUserData(user); setIsLogged(true); setAuthMode('login'); setQrStep('role'); const area = extractShelf(user.AREA); const ehPerfil = AREA_PERFIS.includes(area?.toLowerCase?.()); const prat = !ehPerfil && SHELVES[area] ? area : ''; let def = ''; if (canSwitch(user.PERFIL)) { def = prat || ''; setCadastroShelf(prat || SHELF_KEYS[0]); } else { def = prat || SHELF_KEYS[0]; setCadastroShelf(prat || SHELF_KEYS[0]); } setActiveShelf(def); if (def) loadStock(def); setTimeout(() => triggerAutoClean(), 1500);
    // OneSignal: registra usuário e envia tags para segmentação
    oneSignalLogin(user.id);
    oneSignalSetTags({ perfil: user.PERFIL || '', area: user.AREA || '', nome: user.NOME || '', usuario: user.USUARIO || '' }); }, [loadStock, triggerAutoClean]);
  const switchShelf = async shelf => { 
    setActiveShelf(shelf); 
    setCadastroShelf(shelf); 
    await loadStock(shelf); 
    setShelfModal(false); 
    
    // Atualiza o chat informando a mudança de prateleira para o usuário e para a IA
    const label = shlabel(shelf);
    const msg = `Setor alterado para: ${label}. Estoque carregado com sucesso.`;
    setMsgs(p => [...p, { id: Date.now(), text: msg, isAi: true, system: true }]);
    
    // Injeta contexto no histórico do JARVIS para que ele saiba onde está agora
    jarvisHistoryRef.current = [
      ...jarvisHistoryRef.current.slice(-20), 
      { role: 'user', parts: [{ text: `[SISTEMA] O usuário alterou a prateleira ativa para: ${label} (${shelf}).` }] },
      { role: 'model', parts: [{ text: `Entendido. Agora estamos operando na prateleira ${label}.` }] }
    ];
  };
  const startScan = async mode => {
    try {
      const { status } = await Camera.getCameraPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await Camera.requestCameraPermissionsAsync();
        if (newStatus !== 'granted') {
          showErr('Câmera necessária para usar esta função.');
          return;
        }
      }
      if (mode === 'aiVision') aiVisionTriggeredRef.current = false;
      setScanMode(mode);
      setTorchOn(false);
      setScanning(true);
    } catch (err) {
      showErr('Erro ao iniciar câmera. Verifique as permissões.');
    }
  };
  const chatHistoryRef = useRef([]);


  // ── JARVIS Global Voice Loop — funciona em qualquer tela ───────────────────
  const jarvisWaveStart = (anims) => {
    anims.forEach((a, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 70),
        Animated.timing(a, { toValue: 0.95, duration: 200 + i * 25, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.2, duration: 200 + i * 25, useNativeDriver: true }),
      ])).start();
    });
  };
  const jarvisWaveStop = (anims) => {
    anims.forEach(a => { a.stopAnimation(); Animated.timing(a, { toValue: 0.3, duration: 150, useNativeDriver: true }).start(); });
  };

  // ── JARVIS: handlers do reconhecimento nativo (ExpoSpeechRecognitionModule) ──
  const jarvisNativeResultRef = useRef('');
  const jarvisNativeGotResultRef = useRef(false);

  const onJarvisNativeStart = useCallback(() => {
    setJarvisRecording(true);
    jarvisWaveStart(jarvisWaveAnims);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onJarvisNativeResult = useCallback((event) => {
    const raw = event?.results?.[0]?.transcript || '';
    if (raw && raw.trim()) {
      jarvisNativeResultRef.current = raw.trim();
      jarvisNativeGotResultRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onJarvisNativeEnd = useCallback(() => {
    setJarvisRecording(false);
    jarvisWaveStop(jarvisWaveAnims);
    if (!jarvisLiveRef.current) return; // cancelado

    const text = jarvisNativeResultRef.current;
    jarvisNativeResultRef.current = '';
    const got = jarvisNativeGotResultRef.current;
    jarvisNativeGotResultRef.current = false;

    if (got && text) {
      jarvisFailCountRef.current = 0;
      const clean = text.trim();
      setMsgs(p => [...p, { id: Date.now(), text: clean, isAi: false }]);
      jarvisLiveRef.current = false;
      sendChatVoice(clean, true).then(() => {
        if (jarvisLiveRef.liveOn && !jarvisLiveRef.current) {
          jarvisLiveRef.current = true;
          jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 300);
        }
      });
    } else {
      // Nao entendeu — apos 2 falhas seguidas, avisa o usuario em vez de ficar mudo
      jarvisFailCountRef.current = (jarvisFailCountRef.current || 0) + 1;
      jarvisNagCountRef.current = (jarvisNagCountRef.current || 0);
      if (jarvisFailCountRef.current >= 2) {
        jarvisFailCountRef.current = 0;
        jarvisNagCountRef.current += 1;
        // Apos varias falhas consecutivas, para de repetir a mesma mensagem
        // em loop e desliga o microfone — evita o "loop infinito" no chat.
        if (jarvisNagCountRef.current >= 2) {
          jarvisNagCountRef.current = 0;
          const giveUp = 'Vou pausar o microfone por aqui. Pode digitar sua solicitacao no chat quando quiser.';
          setMsgs(p => [...p, { id: Date.now(), text: giveUp, isAi: true }]);
          jarvisLiveRef.current = false;
          jarvisLiveRef.liveOn = false;
          speakWithElevenLabs(giveUp, () => {});
          return;
        }
        const oops = 'Nao consegui entender. Pode repetir, por favor?';
        setMsgs(p => [...p, { id: Date.now(), text: oops, isAi: true }]);
        jarvisLiveRef.current = false;
        speakWithElevenLabs(oops, () => {
          if (jarvisLiveRef.liveOn) {
            jarvisLiveRef.current = true;
            jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 300);
          }
        });
      } else if (jarvisLiveRef.current) {
        jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 200);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onJarvisNativeError = useCallback((event) => {
    setJarvisRecording(false);
    jarvisWaveStop(jarvisWaveAnims);
    const code = event?.error || '';
    console.warn('[JARVIS] erro reconhecimento nativo:', code);
    jarvisNativeResultRef.current = '';
    jarvisNativeGotResultRef.current = false;
    if (!jarvisLiveRef.current) return;
    if (['no-speech', 'no-match'].includes(code)) {
      jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 200);
    } else {
      jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jarvisRecordChunk = async () => {
    if (!jarvisLiveRef.current) return;
    try {
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
      await new Promise(r => setTimeout(r, 150));

      const ok = await requestMicPermission();
      if (!ok) {
        AppAlert.alert('Microfone', 'Preciso de permissão para ouvir seus comandos.');
        setJarvisVoiceMode(false);
        return;
      }
      if (!jarvisLiveRef.current) return;

      jarvisNativeResultRef.current = '';
      jarvisNativeGotResultRef.current = false;
      await ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: true, continuous: false });
    } catch (err) {
      console.error('[JARVIS] Erro ao iniciar reconhecimento:', err);
      setJarvisRecording(false);
      jarvisWaveStop(jarvisWaveAnims);
      if (jarvisLiveRef.current) jarvisLoopTimer.current = setTimeout(jarvisRecordChunk, 1000);
    }
  };

  const startJarvisLive = async () => {
    if (jarvisLiveRef.current) return;
    
    // ANTI-BUG: Força a parada de QUALQUER outro processo de voz
    try { 
      // 1. Para o reconhecimento nativo (wake-word)
      ExpoSpeechRecognitionModule.stop(); 
      // 2. Para qualquer TTS em andamento
      if (typeof stopElevenLabs === 'function') stopElevenLabs();
    } catch { /* noop */ }

    // 3. Reseta o modo de áudio para limpar buffers
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    
    // 4. Cooldown aumentado para garantir que o SO liberou o hardware do mic
    await new Promise(res => setTimeout(res, 800));

    const { granted } = await Audio.requestPermissionsAsync().catch(() => ({ granted: false }));
    if (!granted) {
      AppAlert.alert('Microfone', 'Preciso de permissão para ouvir seus comandos.');
      setJarvisVoiceMode(false);
      return;
    }

    if (jarvisLiveRef.current) return; 

    jarvisLiveRef.liveOn = true;
    jarvisLiveRef.current = true;

    // Saudações aleatórias do Jarvis ao iniciar
    const greetings = [
      'GEI ativo. Pode falar.',
      'Sistemas prontos. Como posso ajudar, Matheus?',
      'Estou ouvindo. O que deseja consultar?',
      'Pode falar, estou à sua disposição.'
    ];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];

    setMsgs(p => [...p, { id: Date.now(), text: greeting, isAi: true }]);
    
    // Inicia o loop de gravação APÓS o Jarvis terminar de falar a saudação
    speakWithElevenLabs(greeting, () => { 
      if (jarvisLiveRef.liveOn) {
        // Garantia extra de delay pós-fala para não gravar o próprio eco
        setTimeout(jarvisRecordChunk, 400); 
      }
    });
  };

  const stopJarvisLive = async () => {
    jarvisLiveRef.liveOn = false;
    jarvisLiveRef.current = false;
    if (jarvisLoopTimer.current) clearTimeout(jarvisLoopTimer.current);
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
    jarvisWaveStop(jarvisWaveAnims);
    setJarvisRecording(false); setJarvisProcessing(false);
  };

  // Sincroniza jarvisVoiceMode com o loop
  useEffect(() => {
    if (jarvisVoiceMode) startJarvisLive();
    else stopJarvisLive();
    return () => stopJarvisLive();
  }, [jarvisVoiceMode]);

    // ── GEI JARVIS — Chat inteligente multi-turn com function calling ──────────
  const jarvisHistoryRef = useRef([]);   // histórico Gemini multi-turn

  // ── Helper: prateleiras que o operador atual pode usar ─────────────────────
  const _getAllowedShelves = () => {
    const perfil = userData?.PERFIL || '';
    if (isCoord(perfil) || isDeposito(perfil)) return SHELF_KEYS; // acesso total
    // Repositor: só a prateleira da sua AREA
    const area = extractShelf(userData?.AREA || '');
    return area && SHELVES[area] ? [area] : (activeShelf ? [activeShelf] : SHELF_KEYS.slice(0, 1));
  };

  // ── Helper: detecta prateleira correta pelo nome do produto no estoque ──────
  const _detectShelfByProduct = (nomeRaw) => {
    if (!nomeRaw) return null;
    const n = nomeRaw.toLowerCase();
    // Primeiro verifica se já existe no estoque com nome similar
    const existing = stockData.find(p => {
      const pn = (p.produto || '').toLowerCase();
      // Match por primeiras palavras relevantes (ignora artigos)
      const words = n.split(/\s+/).filter(w => w.length > 2);
      return words.length > 0 && words.some(w => pn.includes(w));
    });
    if (existing) {
      // Descobre a prateleira desse produto
      for (const k of SHELF_KEYS) {
        const shelfData = stockData.filter(p => {
          // Não temos campo de prateleira no item, mas activeShelf é a carregada
          // Usamos heurística de categoria pelo nome
          return (p.produto || '').toLowerCase() === (existing.produto || '').toLowerCase();
        });
        if (shelfData.length > 0) break;
      }
    }
    // Heurística por categoria do produto
    const catMap = [
      { shelf: 'bebida',   words: ['coca','pepsi','guarana','fanta','sprite','soda','refrigerante','suco','agua','cerveja','energetico','isoton','limonada','cha','mate'] },
      { shelf: 'frios',    words: ['leite','iogurte','queijo','requeijao','manteiga','margarina','presunto','mortadela','salsicha','frios','laticinios','creme','nata','coalhada'] },
      { shelf: 'biscoito', words: ['biscoito','bolacha','wafer','recheado','rosquinha','cream','cracker','cookie','chocolate','barra','amendoim','bala','chiclete','pirulito','doce','confeito','brigadeiro'] },
      { shelf: 'macarrao', words: ['macarrao','massa','espaguete','talharim','parafuso','farinha','arroz','feijao','lentilha','grao','caldo','tempero','azeite','oleo','vinagre','molho','extrato'] },
      { shelf: 'pesado',   words: ['detergente','sabao','amaciante','desinfetante','agua sanitaria','multiuso','esponja','vassoura','papel','fralda','absorvente','sabonete','shampoo','condicionador','creme dental','pasta','escova','desodorante','perfume','alcool','produto de limpeza'] },
    ];
    for (const { shelf, words } of catMap) {
      if (words.some(w => n.includes(w))) return shelf;
    }

  // ── Helper: SCORE de cada prateleira para um nome (qtde de palavras-chave) ──
  const _scoreShelves = (nomeRaw) => {
    const n = String(nomeRaw || '').toLowerCase();
    const cat = {
      bebida:   ['coca','pepsi','guarana','fanta','sprite','soda','refrigerante','suco','agua','cerveja','energetico','isoton','limonada','cha','mate','vinho','whisky','gin','vodka','rum','licor'],
      frios:    ['leite','iogurte','queijo','requeijao','manteiga','margarina','presunto','mortadela','salsicha','frios','laticinios','creme','nata','coalhada','linguiça','linguica'],
      biscoito: ['biscoito','bolacha','wafer','recheado','rosquinha','cream','cracker','cookie','chocolate','barra','amendoim','bala','chiclete','pirulito','doce','confeito','brigadeiro','snack','salgadinho'],
      macarrao: ['macarrao','massa','espaguete','talharim','parafuso','farinha','arroz','feijao','lentilha','grao','caldo','tempero','azeite','oleo','vinagre','molho','extrato','sal','acucar','cafe','achocolatado','aveia'],
      pesado:   ['detergente','sabao','amaciante','desinfetante','agua sanitaria','multiuso','esponja','vassoura','papel','fralda','absorvente','sabonete','shampoo','condicionador','creme dental','pasta','escova','desodorante','perfume','alcool','produto de limpeza','rodo','pano'],
    };
    const scores = {};
    for (const k of SHELF_KEYS) scores[k] = 0;
    for (const [shelf, words] of Object.entries(cat)) {
      for (const w of words) if (n.includes(w)) scores[shelf] = (scores[shelf] || 0) + 1;
    }
    return scores;
  };

  // ── Helper: resolve a MELHOR prateleira respeitando pinnedShelf + permissões ─
  // Nunca recusa — sempre devolve uma chave válida dentre as permitidas.
  const _smartResolveShelf = (nomeUso, requested) => {
    const allowed = _getAllowedShelves();
    if (!allowed.length) return activeShelf;

    // 1) FIXADO pelo operador (botão "Fixar prateleira atual" no chat)
    if (pinnedShelf && SHELVES[pinnedShelf] && allowed.includes(pinnedShelf)) {
      return pinnedShelf;
    }
    // 2) Sugestão explícita da IA, se permitida
    if (requested && SHELVES[requested] && allowed.includes(requested)) {
      return requested;
    }
    // 3) Detecção semântica (heurística forte por palavra-chave)
    const detected = _detectShelfByProduct(nomeUso);
    if (detected && allowed.includes(detected)) return detected;

    // 4) MELHOR pontuação dentre as PERMITIDAS
    const scores = _scoreShelves(nomeUso);
    let best = null, bestScore = -1;
    for (const k of allowed) {
      if ((scores[k] || 0) > bestScore) { best = k; bestScore = scores[k] || 0; }
    }
    if (best && bestScore > 0) return best;

    // 5) Prateleira ativa, se permitida
    if (activeShelf && allowed.includes(activeShelf)) return activeShelf;

    // 6) Primeira permitida (último recurso)
    return allowed[0];
  };

    return null;
  };

  const JARVIS_SYSTEM = () => {
    const now = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const perfil = userData?.PERFIL || 'N/A';
    const userArea = extractShelf(userData?.AREA || '');
    const allowedShelves = _getAllowedShelves();
    const isFullAccess = isCoord(perfil) || isDeposito(perfil);

    const sample = stockData.slice(0, 20).map(s => {
      const m = buildDepletionMetrics(s, fifoMode, stockData, s.codig);
      return s.produto + ' | val:' + s.VENCIMENTO + ' | ' + m.remainingQty + 'un | ruptura:' + m.remainingDays + 'd';
    }).join('\n');
    const warn  = stockData.filter(i => vencStatus(i.VENCIMENTO).status === 'warning').map(i => i.produto + '(' + i.VENCIMENTO + ')').join(', ');
    const exp   = stockData.filter(i => vencStatus(i.VENCIMENTO).status === 'expired').map(i => i.produto + '(' + i.VENCIMENTO + ')').join(', ');

    // Monta lista de marcas/produtos existentes para o sistema reconhecer
    const brandSample = [...new Set(stockData.slice(0, 40).map(s => (s.produto || '').split(' ').slice(0,3).join(' ')))].slice(0, 20).join(', ');

    return (
      'IDENTIDADE: Voce e o GEI, assistente de estoque de supermercado. ' +
      'Personalidade: direto, eficaz, zero enrolacao. Nao titubeie. Nao explique o que vai fazer — FACA.\n\n' +

      '=== OPERADOR ===\n' +
      'Nome: ' + (userData?.NOME || 'N/A') + '\n' +
      'Perfil: ' + perfil + '\n' +
      'Area: ' + (userArea ? shlabel(userArea) : 'N/A') + '\n' +
      'Acesso: ' + (isFullAccess ? 'TOTAL' : 'RESTRITO — apenas: ' + allowedShelves.map(k => shlabel(k) + '(' + k + ')').join(', ')) + '\n\n' +

      '=== PRATELEIRAS DISPONIVEIS ===\n' +
      SHELF_KEYS.map(k => shlabel(k) + '=' + k + (allowedShelves.includes(k) ? ' ✓' : ' ✗')).join(' | ') + '\n' +
      'Prateleira ativa: ' + shlabel(activeShelf) + ' (' + activeShelf + ')' +
      (pinnedShelf ? ' [FIXADA — use sempre esta]' : '') + '\n\n' +

      '=== ESTOQUE ATUAL ===\n' +
      'Total: ' + stockData.length + ' itens | ' +
      'Vencendo 7d: ' + (warn || 'nenhum') + ' | Vencidos: ' + (exp || 'nenhum') + '\n' +
      (sample ? 'Amostra:\n' + sample + '\n' : '') + '\n' +

      '=== MAPEAMENTO DE CATEGORIAS ===\n' +
      'bebida = refrigerante, suco, agua, cerveja, energetico, cha, isotonico, kombucha, vinho\n' +
      'frios  = leite, iogurte, queijo, requeijao, manteiga, presunto, mortadela, salsicha, frios\n' +
      'biscoito = biscoito, bolacha, chocolate, doce, bala, snack, wafer, pirulito, chiclete\n' +
      'macarrao = arroz, feijao, macarrao, massa, farinha, azeite, oleo, tempero, molho, extrato, lentilha, quinoa\n' +
      'pesado = detergente, sabao, desinfetante, papel, fralda, sabonete, shampoo, condicionador, amaciante\n\n' +

      '=== FUNCOES DE ACAO ===\n' +
      'CADASTRAR PRODUTO:\n' +
      '<<<FN:cadastrar_produto>>>{\"nome\":\"NOME COMPLETO\",\"validade\":\"DD/MM/AAAA\",\"prateleira\":\"chave\"}<<<END>>>\n\n' +
      'REMOVER PRODUTO (ultimo cadastrado ou por nome):\n' +
      '<<<FN:remover_produto>>>{\"nome\":\"NOME OU VAZIO\"}<<<END>>>\n\n' +
      'CONSULTAR PRATELEIRA:\n' +
      '<<<FN:consultar_prateleira>>>{\"prateleira\":\"chave\"}<<<END>>>\n\n' +

      '=== REGRAS ABSOLUTAS DE CADASTRO ===\n\n' +

      'REGRA 1 — ACAO IMEDIATA:\n' +
      'Quando o usuario pedir para cadastrar um produto E voce souber o nome E a validade:\n' +
      'EMITA O BLOCO <<<FN:cadastrar_produto>>> IMEDIATAMENTE NA MESMA RESPOSTA.\n' +
      'NAO existe "vou cadastrar", "estou cadastrando", "produto sera registrado" sem o bloco.\n' +
      'O bloco FN e a UNICA prova de que o cadastro aconteceu. Sem ele = nada foi feito.\n\n' +

      'REGRA 2 — NOME DO PRODUTO:\n' +
      'Sempre: MARCA + TIPO + VOLUME/PESO. Exemplos:\n' +
      '"coca" → "COCA-COLA 600ML" | "leite ninho" → "LEITE NINHO 400G" | "ype" → "DETERGENTE YPE 500ML"\n' +
      'Se o usuario disse um nome especifico, use-o. Nunca coloque apenas "PRODUTO".\n\n' +

      'REGRA 3 — VALIDADE:\n' +
      'Extraia exatamente o que o usuario disse. Se o ano for < 2020, some 10 (2016→2026).\n' +
      'Formato final: DD/MM/AAAA. Sem validade → pergunte UMA vez, curto.\n\n' +

      'REGRA 4 — PRATELEIRA:\n' +
      'Deduza pelo tipo do produto usando o MAPEAMENTO acima.\n' +
      'Se pinnedShelf estiver ativa, use SEMPRE ela.\n' +
      'Nunca use prateleira marcada com ✗.\n\n' +

      'REGRA 5 — FLUXO CORRETO:\n' +
      'Usuario: "coloca coca-cola 600ml validade 15/07/2026"\n' +
      'CORRETO: "✅ Cadastrado." + <<<FN:cadastrar_produto>>>{\"nome\":\"COCA-COLA 600ML\",\"validade\":\"15/07/2026\",\"prateleira\":\"bebida\"}<<<END>>>\n' +
      'ERRADO: "Coca-Cola 600ml, valida até 15/07/2026, está sendo cadastrada na prateleira Bebidas." (SEM BLOCO = FALHA)\n\n' +

      'REGRA 6 — AMBIGUIDADE:\n' +
      'Nunca diga "nao entendi", "pode repetir", "nao consegui".\n' +
      'Se for ambiguo, deduza pelo contexto, aja, e informe o que fez.\n\n' +

      'REGRA 7 — MODO VOZ:\n' +
      'Maximo 2 frases curtas. Zero markdown.\n\n' +

      'LEMBRE-SE: O bloco <<<FN:cadastrar_produto>>> e OBRIGATORIO sempre que houver cadastro. SEMPRE.'
    );
  };

  const jarvisExecuteFn = async (name, args) => {
    if (name === 'cadastrar_produto') {
      if (!args.nome || !args.validade) {
        return 'Preciso da data de validade para cadastrar. Qual a validade do produto?';
      }

      // ── 1. Corrigir nome — enriquece se genérico ───────────────────────────
      let nomeUso = String(args.nome).trim().toUpperCase();
      // Se IA devolveu nome muito curto (< 4 chars) ou genérico, tenta melhorar
      if (nomeUso.length < 4 || nomeUso === 'PRODUTO') {
        nomeUso = 'PRODUTO SEM NOME';
      }

      // ── 2. Corrigir data ────────────────────────────────────────────────────
      const validadeBruta = String(args.validade).trim();
      let validadeCorrigida = validadeBruta;
      if (!isValidDate(validadeBruta)) {
        const parsed = parsePortugueseDate(validadeBruta);
        if (parsed) validadeCorrigida = parsed;
      }
      validadeCorrigida = smartCorrectDate(validadeCorrigida);
      if (!isValidDate(validadeCorrigida)) {
        return 'Nao consegui interpretar a data. Informe no formato DD/MM/AAAA.';
      }

      // ── 3. Resolver prateleira (NUNCA recusa — pin > IA > heurística > score) ─
      //   Regra: se o operador clicou em "Fixar prateleira atual" no chat,
      //   todo produto vai para essa prateleira. Caso contrário, a IA tenta
      //   deduzir a mais adequada DENTRE as permitidas.
      let shelf = _smartResolveShelf(nomeUso, args.prateleira);
      const allowed = _getAllowedShelves();
      if (!SHELVES[shelf]) shelf = allowed[0];
      if (!SHELVES[shelf]) return 'Nenhuma prateleira disponivel. Verifique com o Coordenador.';

      // ── 3.5. PATCH: IA inteligente pensa em etapas e enriquece o nome
      //    (marca real, gramatura, EAN-13 BR, ml/g consistente). Nao bloqueia
      //    o cadastro se falhar — apenas melhora o nome quando possivel.
      let smartPergunta = '';
      let smartIncoerencias = [];
      try {
        const rawSmart = await callSmartCadastroIA(args.nome, {
          prateleira: shelf, validade: validadeCorrigida,
          nomeOriginal: args.nome, perfil: userData?.PERFIL || ''
        });
        const parsed = parseSmartCadastroJSON(rawSmart);
        if (parsed && parsed.produto && parsed.produto.nome) {
          const enriched = String(parsed.produto.nome).trim().toUpperCase();
          if (enriched.length >= 4 && enriched !== 'PRODUTO SEM NOME') nomeUso = enriched;
          smartPergunta = parsed.pergunta && parsed.pergunta !== 'null' ? String(parsed.pergunta) : '';
          smartIncoerencias = Array.isArray(parsed.incoerencias) ? parsed.incoerencias : [];
        }
        // Mostra o modal "IA pensando" com efeito de digitacao
        if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
          setSmartCadastro({
            visible: true, steps: parsed.steps, typedSteps: [],
            produto: parsed.produto || null, pergunta: smartPergunta,
            promptInterno: parsed.promptInterno || '',
            incoerencias: smartIncoerencias, done: false
          });
          // Digita uma etapa por vez (700ms cada)
          parsed.steps.forEach((step, idx) => {
            setTimeout(() => setSmartCadastro(s => ({ ...s, typedSteps: [...s.typedSteps, step], done: idx === parsed.steps.length - 1 })), 700 * (idx + 1));
          });
          // Auto-fecha 2.5s apos a ultima etapa
          setTimeout(() => setSmartCadastro(s => ({ ...s, visible: false })), 700 * (parsed.steps.length + 1) + 2500);
        }
      } catch (eSmart) { console.warn('[SmartCadastro] enriquecimento falhou:', eSmart?.message); }

      //    O usuario pode pedir para "remover" depois caso o produto detectado
      //    esteja errado — sem precisar confirmar manualmente cada cadastro.
      const tid = SHELVES[shelf];
      if (!tid) return 'Prateleira invalida. Verifique com o Coordenador.';
      try {
        // Otimização: Criamos o objeto do produto para atualização instantânea na UI
        const dataEnvio = new Date().toLocaleDateString('pt-BR');
        const previsao = calculatePrevisao(0, 'Medio giro', dataEnvio);
        
        // Dados formatados para o Baserow (garantindo que tipos batam)
        const baserowData = { 
          produto: nomeUso, 
          codig: 'Sem EAN', 
          VENCIMENTO: validadeCorrigida, 
          quantidade: '0',
          ENVIADOPORQUEM: (userData && userData.NOME) || 'GEI', 
          PERFILFOTOURL: (userData && userData.PERFILFOTOURL) || '',
          BOLETIM: false, 
          DATAENVIO: dataEnvio, 
          ALERTAMENSAGEM: '', 
          MARGEM: 'Medio giro',
          PREVISAO: previsao 
        };

        const tempId = 'temp-' + Date.now();
        const newProd = { ...baserowData, id: tempId, _localTs: Date.now(), _justAdded: true, _shelf: shelf };

        // Se a IA cadastrou em uma prateleira diferente da ativa, avisa e troca automaticamente
        let shelfChangedMsg = '';
        if (shelf !== activeShelf) {
          shelfChangedMsg = `\n\n🔄 Alterando visão para ${shlabel(shelf)}...`;
          setActiveShelf(shelf);
          setCadastroShelf(shelf);
          await loadStock(shelf); // Carrega o estoque da nova prateleira antes de inserir
        }

        // Atualização otimista: Garante que o estado seja atualizado IMEDIATAMENTE
        setStockData(prev => sortProductsByDate([newProd, ...prev]));

        // Transparência: Log do que está sendo enviado
        console.log(`[JARVIS] Enviando para Baserow na tabela ${tid}:`, baserowData);

        const resp = await secureAxiosInstance.post(
          'https://api.baserow.io/api/database/rows/table/' + tid + '/?user_field_names=true',
          baserowData
        );
        
        await addAuditLog('JARVIS_ADD_AUTO', nomeUso + ' via GEI JARVIS (auto-confirmado)', userData && userData.id);
        
        // Atualiza o ID real no estado local e força re-render se necessário
        if (resp?.data?.id) {
          setStockData(prev => {
            const updated = prev.map(p => p.id === tempId ? { ...p, id: resp.data.id } : p);
            return sortProductsByDate(updated);
          });
          // Força recarregamento do estoque para garantir sincronia total com o servidor
          setTimeout(() => loadStock(shelf), 800);
        }

        // guarda o ultimo produto cadastrado pela IA para permitir "remover" rapido
        jarvisLastAddedRef.current = { id: resp?.data?.id || tempId, produto: nomeUso, shelf, validade: validadeCorrigida };
        // PATCH: forca a aparicao IMEDIATA do produto no painel Estoque com animacao de "montagem"
        try {
          setActiveFilter('all');
          setEstoqueBuilding({ visible: true, produto: nomeUso, shelf, validade: validadeCorrigida });
          navTo('estoque');
          // Auto-fecha o overlay apos 2.6s (tempo da animacao)
          setTimeout(() => setEstoqueBuilding(s => ({ ...(s||{}), visible: false })), 2600);
        } catch (eUI) { console.warn('[JARVIS] UI refresh falhou:', eUI?.message); }
        
        const extras = [];
        if (smartIncoerencias && smartIncoerencias.length) extras.push('⚠️ ' + smartIncoerencias.join(' · '));
        if (smartPergunta) extras.push('❓ ' + smartPergunta);
        const extrasMsg = extras.length ? ('\n\n' + extras.join('\n')) : '';
        return `✅ Pronto. ${nomeUso} cadastrado em ${shlabel(shelf)} com validade ${validadeCorrigida} — ja confirmado automaticamente.${shelfChangedMsg}${extrasMsg}\nSe nao for o produto certo, so dizer "remove" e eu apago.`;
      } catch {
        return 'Erro ao salvar o produto. Tente novamente.';
      }
    }

    if (name === 'remover_produto') {
      // Remove o ultimo produto cadastrado automaticamente pela IA, ou busca
      // por nome no estoque atual e remove o primeiro que combinar.
      const alvo = (args && args.nome ? String(args.nome).trim().toLowerCase() : '');
      let target = null;
      let targetShelf = activeShelf;

      if (!alvo && jarvisLastAddedRef.current) {
        target = jarvisLastAddedRef.current;
        targetShelf = target.shelf || activeShelf;
      } else if (alvo) {
        // tenta achar no estoque carregado (prateleira ativa)
        const found = stockData.find(p => (p.produto || '').toLowerCase().includes(alvo));
        if (found) { target = { id: found.id, produto: found.produto }; targetShelf = activeShelf; }
        else if (jarvisLastAddedRef.current && (jarvisLastAddedRef.current.produto || '').toLowerCase().includes(alvo)) {
          target = jarvisLastAddedRef.current;
          targetShelf = target.shelf || activeShelf;
        }
      }

      if (!target || !target.id) {
        return 'Nao encontrei o produto para remover. Diga o nome exato ou peca para remover o ultimo cadastrado.';
      }

      const tid = SHELVES[targetShelf];
      if (!tid) return 'Prateleira invalida para remocao.';

      try {
        await secureAxiosInstance.delete(`https://api.baserow.io/api/database/rows/table/${tid}/${target.id}/`);
        await addAuditLog('JARVIS_REMOVE', `Produto "${target.produto}" removido via GEI JARVIS`, userData && userData.id);
        if (jarvisLastAddedRef.current && jarvisLastAddedRef.current.id === target.id) jarvisLastAddedRef.current = null;
        if (targetShelf === activeShelf) {
          setStockData(prev => sortProductsByDate(prev.filter(p => p.id !== target.id)));
        }
        return `Removido. ${target.produto} foi excluido de ${shlabel(targetShelf)}.`;
      } catch {
        return 'Erro ao remover o produto. Tente novamente.';
      }
    }

    if (name === 'consultar_prateleira') {
      const reqShelf = (args && args.prateleira) || activeShelf;
      const allowed = _getAllowedShelves();
      const shelf = allowed.includes(reqShelf) ? reqShelf : (allowed[0] || activeShelf);
      const itens = stockData.slice(0, 20).map(s => {
        const m = buildDepletionMetrics(s, fifoMode, stockData, s.codig);
        return s.produto + '(' + m.remainingQty + 'un, val:' + s.VENCIMENTO + ')';
      }).join(', ');
      return 'Prateleira ' + shlabel(shelf) + ': ' + (itens || 'vazia');
    }
    return 'Funcao desconhecida';
  };

  // ── Detecta se a IA está explicando que vai corrigir a data (sem cadastrar) ─
  const _javisIsDateCorrection = (text) => {
    if (!text) return false;
    const t = text.toLowerCase();
    // Contém intenção de corrigir/ajustar data MAS não emitiu o bloco de função
    const hasCorrectIntent = (
      /corri(gir|gindo|jo|gi)\s*(a\s*)?(data|validade|ano)/.test(t) ||
      /ajust(ar|ando|o|ei)\s*(a\s*)?(data|validade|ano)/.test(t) ||
      /vou\s*(usar|utilizar|considerar|adotar)\s*20[2-9]\d/.test(t) ||
      /improvav(el|ável)\s*(para|num|em)\s*produto/.test(t) ||
      /ano\s*20\d\d\s*(é|e)\s*improvav/.test(t) ||
      /usando\s*20[2-9]\d/.test(t) ||
      /(2016|2017|2018|2019)\s*(é|e)\s*improvav/.test(t) ||
      /primeiro.*corrigi|corrigi.*data|antes.*corrigi/.test(t)
    );
    const hasFnBlock = /<<<FN:/.test(text);
    return hasCorrectIntent && !hasFnBlock;
  };

  // ── Motor de chamada à IA (raw, sem histórico) ────────────────────────────
  const _callAIRaw = async (sysText, history, maxTok, temperature = 0.15) => {
    let raw = '';
    const tryGemini = async (model) => {
      const body = {
        system_instruction: { parts: [{ text: sysText }] },
        contents: history,
        generationConfig: { temperature, maxOutputTokens: maxTok }
      };
      const r = await fetchWithTimeout(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + RT_API_KEY_IA,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        7000
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const t = (d?.candidates?.[0]?.content?.parts?.[0]?.text) || '';
      if (!t.trim()) throw new Error('empty response');
      return t;
    };
    const tryGroq = async (model) => {
      if (!GROQ_API_KEY) throw new Error('no key');
      const messages = [{ role: 'system', content: sysText }];
      history.slice(-10).forEach(m => {
        messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: (m.parts?.[0]?.text) || (m.content || '') });
      });
      const r = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTok, temperature })
      }, 7000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const t = (d?.choices?.[0]?.message?.content) || '';
      if (!t.trim()) throw new Error('empty');
      return t;
    };
    const providers = [
      { name: 'Gemini 2.0 Flash', fn: () => tryGemini('gemini-2.0-flash') },
      { name: 'Groq LLaMA 3.3',   fn: () => tryGroq('llama-3.3-70b-versatile') },
      { name: 'Gemini 2.0 Lite',  fn: () => tryGemini('gemini-2.0-flash-lite') },
      { name: 'Gemini 1.5 Flash', fn: () => tryGemini('gemini-1.5-flash') },
      { name: 'Groq LLaMA 3',     fn: () => tryGroq('llama3-8b-8192') },
      { name: 'Groq Mixtral',     fn: () => tryGroq('mixtral-8x7b-32768') },
    ];
    for (const p of providers) {
      try { raw = await p.fn(); if (raw?.trim()) { console.log('[JARVIS] respondeu via', p.name); break; } }
      catch (e) { console.warn('[JARVIS]', p.name, 'falhou:', e.message); }
    }
    return raw;
  };

  // ── Typewriter: exibe msg com ID fixo, vai atualizando char a char ────────
  const _typewriterMsg = (msgId, finalText, onDone) => {
    let i = 0;
    const step = () => {
      i += Math.floor(Math.random() * 3) + 2; // 2-4 chars por tick
      const slice = finalText.slice(0, i);
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, text: slice } : m));
      if (i < finalText.length) setTimeout(step, 28);
      else { setMsgs(p => p.map(m => m.id === msgId ? { ...m, text: finalText, thinking: false } : m)); if (onDone) onDone(); }
    };
    step();
  };

  const callJarvis = async (userText, isVoice) => {
    const sysText = JARVIS_SYSTEM() + (isVoice ? ' MODO VOZ: maximo 2 frases curtas, zero markdown.' : '');
    const maxTok  = isVoice ? 200 : 800;
    const jarvisTempLow = 0.10; // Temperatura baixa = mais determinístico, segue instruções

    jarvisHistoryRef.current = [...jarvisHistoryRef.current, { role:'user', parts:[{ text: userText }] }];
    if (jarvisHistoryRef.current.length > 40) jarvisHistoryRef.current = jarvisHistoryRef.current.slice(-30);

    // ── Extrai dados do produto da mensagem do usuário (antes de chamar a IA)
    //    Se o usuário já enviou nome + validade, temos o suficiente para cadastrar.
    const _parseUserMsg = (txt) => {
      const t = String(txt || '');
      const monthMap = {
        jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12,
        janeiro:1,fevereiro:2,'março':3,abril:4,maio:5,junho:6,julho:7,agosto:8,
        setembro:9,outubro:10,novembro:11,dezembro:12
      };

      const parseYear = (y) => {
        let s = String(y).replace(/\D/g,'');
        if (s.length === 5 && s.startsWith('20')) s = '20' + s.slice(3); // "20127" → "2027"
        if (s.length > 4) s = s.slice(0,4);
        let yr = parseInt(s,10);
        if (s.length <= 2) yr = 2000 + yr;
        if (yr < 2020) yr += 10;
        return yr;
      };

      let validade = null;
      // Formato: "15/03/2027" ou "15-3-27"
      const d1 = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,5})\b/);
      // Formato: "15 dos 3 de 2027" / "15 de março de 2027" / "15 03 2027"
      const d2 = t.match(/\b(\d{1,2})\s+(?:de\s+|dos?\s+|do\s+)?(\d{1,2}|jan(?:eiro)?|fev(?:ereiro)?|mar(?:ço)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\s+(?:de\s+|dos?\s+)?(\d{4,5})\b/i);
      // Formato: "março de 2027" / "março/2027"
      const d3 = t.match(/\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:ço)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\s*(?:de\s+|\/)?(\d{4,5})\b/i);

      if (d1) {
        const day = parseInt(d1[1],10), mon = parseInt(d1[2],10), yr = parseYear(d1[3]);
        validade = String(day).padStart(2,'0')+'/'+String(mon).padStart(2,'0')+'/'+yr;
      } else if (d2) {
        const day = parseInt(d2[1],10);
        let mon = parseInt(d2[2],10);
        if (isNaN(mon)) mon = monthMap[d2[2].toLowerCase().slice(0,3)] || 1;
        const yr = parseYear(d2[3]);
        validade = String(day).padStart(2,'0')+'/'+String(mon).padStart(2,'0')+'/'+yr;
      } else if (d3) {
        const mon = monthMap[d3[1].toLowerCase().slice(0,3)] || 1;
        const yr = parseYear(d3[2]);
        validade = '01/'+String(mon).padStart(2,'0')+'/'+yr;
      }

      // ── Intent de cadastro ─────────────────────────────────────────────────
      const hasCadastroIntent =
        /(coloc[ao]|cadastr[ao]|adicion[ao]|registr[ao]|inclu[ií]|bot[ao]|lan[çc][ao]|salv[ao]|inser[ei])\b/i.test(t) ||
        /(quero|preciso|pode|vai|vou|tem que)\s+(cadastrar|adicionar|colocar|registrar|incluir|lançar|salvar)/i.test(t) ||
        /é\s+(só|somente)\s+no\s+produto/i.test(t);

      // ── Nome do produto ────────────────────────────────────────────────────
      // StopWords: onde o nome termina (não corta em preposições como "del", "da", "do")
      const stopRe = /\s+(?:com\s+a\s+val|com\s+val|a\s+val|val(?:idade)?(?:\s+|$)|venc(?:imento)?(?:\s+|$)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,5}|\d{1,2}\s+d[eo]s?\s+\d|\d{1,2}\s+de\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))/i;

      let nome = null;
      // Após verbo de cadastro
      const verbRe = /(?:coloc[ao]|cadastr[ao]|adicion[ao]|registr[ao]|bot[ao]|lan[çc][ao]|salv[ao]|inser[ei])\s+(?:um[ao]?\s+|o\s+produto\s+|a\s+produto\s+|os?\s+produto\s+|uma?\s+produto\s+|[ao]\s+)?/i;
      const verbMatch = t.match(verbRe);
      if (verbMatch) {
        const afterVerb = t.slice(verbMatch.index + verbMatch[0].length);
        const stopMatch = afterVerb.match(stopRe);
        const raw = (stopMatch ? afterVerb.slice(0, stopMatch.index) : afterVerb.slice(0, 65)).trim().replace(/\s+/g,' ').replace(/[,\.]+$/,'');
        if (raw.length >= 3) nome = raw.toUpperCase();
      }
      // Fallback: "produto X" / "é só no produto X"
      if (!nome) {
        const np = t.match(/(?:é\s+só\s+(?:no\s+)?produto|produto|item)\s+([A-Za-záêéíóúãõç0-9\s\-\.]{3,60?}?)(?:\s+(?:com|de|a)\s+(?:a\s+)?val|\s+venc|\s+\d{1,2}\/|$)/i);
        if (np?.[1]) nome = np[1].trim().toUpperCase();
      }

      return { validade, nome, hasCadastroIntent };
    };

    const userParsed = _parseUserMsg(userText);

    // ── Thinking indicator
    const thinkId = Date.now() + 777;
    setMsgs(p => [...p, { id: thinkId, text:'🧠 Processando...', isAi:true, thinking:true }]);

    // ACAO DIRETA: se temos nome + validade + intenção da mensagem do usuário → cadastra SEM chamar IA
    if (userParsed.hasCadastroIntent && userParsed.nome && userParsed.validade) {
      console.log('[JARVIS] Dados completos extraídos do usuário — cadastro direto SEM IA:', userParsed.nome, userParsed.validade);
      const thinkId2 = Date.now() + 100;
      setMsgs(p => [...p, { id: thinkId2, text: '⚙️ Cadastrando...', isAi: true, thinking: true }]);
      try {
        const shelf = _smartResolveShelf(userParsed.nome, null);
        const r = await jarvisExecuteFn('cadastrar_produto', { nome: userParsed.nome, validade: userParsed.validade, prateleira: shelf });
        setMsgs(p => p.filter(m => m.id !== thinkId2));
        const finalReply = String(r || '✅ Cadastrado.');
        jarvisHistoryRef.current = [...jarvisHistoryRef.current, { role: 'model', parts: [{ text: finalReply }] }];
        return finalReply;
      } catch (eDirect) {
        setMsgs(p => p.filter(m => m.id !== thinkId2));
        console.warn('[JARVIS] cadastro direto falhou, tentando via IA:', eDirect.message);
        // Continua para a chamada da IA como fallback
      }
    }

    let raw = await _callAIRaw(sysText, jarvisHistoryRef.current, maxTok, jarvisTempLow);
    setMsgs(p => p.filter(m => m.id !== thinkId));

    if (!raw?.trim()) raw = 'Sem conexao com a IA. Tente novamente.';

    // ── AUTO-CORREÇÃO DE DATA ────────────────────────────────────────────────
    if (_javisIsDateCorrection(raw)) {
      console.log('[JARVIS] Correção de data detectada — auto-fix.');
      const fixThinkId = Date.now() + 500;
      setMsgs(p => [...p, { id: fixThinkId, text:'⚙️ Corrigindo data e cadastrando...', isAi:true, thinking:true }]);
      const autoHistory = [
        ...jarvisHistoryRef.current,
        { role:'model', parts:[{ text: raw }] },
        { role:'user', parts:[{ text:
          '[SISTEMA] Corrija o ano automaticamente (< 2020 → soma 10) e emita AGORA:\n' +
          '<<<FN:cadastrar_produto>>>{\"nome\":\"...\",\"validade\":\"DD/MM/AAAA\",\"prateleira\":\"chave\"}<<<END>>>\n' +
          'Apenas o bloco, nada mais.'
        }] },
      ];
      const autoRaw = await _callAIRaw(JARVIS_SYSTEM(), autoHistory, 300, 0.05);
      setMsgs(p => p.filter(m => m.id !== fixThinkId));
      const fixFn = autoRaw?.match(/<<<FN:(\w+)>>>([\s\S]*?)<<<END>>>/);
      if (fixFn) {
        try {
          const r = await jarvisExecuteFn(fixFn[1], JSON.parse(fixFn[2].trim()));
          const final = String(r || '');
          jarvisHistoryRef.current = [...autoHistory, { role:'model', parts:[{ text: final }] }];
          return final;
        } catch(e) { console.warn('[JARVIS] autofix exec error:', e.message); }
      }
      // Fallback: usa dados extraídos do usuário
      if (userParsed.nome && userParsed.validade) {
        const shelf = _smartResolveShelf(userParsed.nome, null);
        const r = await jarvisExecuteFn('cadastrar_produto', { nome: userParsed.nome, validade: userParsed.validade, prateleira: shelf });
        jarvisHistoryRef.current = [...autoHistory, { role:'model', parts:[{ text: String(r||'') }] }];
        return String(r || 'Cadastrado com correção de data.');
      }
    }

    // ── Tenta extrair bloco FN da resposta normal
    let fnMatch = raw.match(/<<<FN:(\w+)>>>([\s\S]*?)<<<END>>>/);
    let reply   = raw.replace(/<<<FN:\w+>>>[\s\S]*?<<<END>>>/g, '').trim();

    // ── INTERCEPTAÇÃO: IA falou mas não agiu ────────────────────────────────
    // Detecta se a IA declarou intenção de cadastro sem emitir o bloco FN.
    // Estratégia: 3 níveis em cascata:
    //   1. Extrai dados da RESPOSTA da IA
    //   2. Extrai dados da MENSAGEM DO USUÁRIO
    //   3. Pede para a IA re-emitir com prompt cirúrgico (última chance)
    if (!fnMatch) {
      const low = (raw || '').toLowerCase();

      // Detecção ampla de intenção de cadastro na resposta da IA
      const iaDeclarou =
        /(vou cadastrar|irei cadastrar|cadastrarei|cadastrando|vou registrar|registrarei|vou adicionar|adicionarei|vou inserir|inserirei|vou colocar|estou cadastrando|estou registrando|considerando o produto|cadastrando na prateleira|cadastro na prateleira|está sendo cadastra|já está cadastra|está cadastra)/i.test(raw) ||
        /(será cadastrado|foi cadastrado|cadastrado(?:\s+com sucesso)?|pronto(?:\s+para cadastrar)?|produto(?:\s+\w+)?\s+cadastrado)/i.test(raw);

      // Tem algum dado de produto (validade ou prateleira) na resposta
      const temDadosProduto = /(\d{2}\/\d{2}\/20\d{2}|validade|prateleira|vencimento|\/202[0-9])/i.test(raw);

      if (iaDeclarou || (userParsed.hasCadastroIntent && userParsed.nome && userParsed.validade)) {
        console.log('[JARVIS] IA declarou cadastro sem FN — interceptando.');
        const intercId = Date.now() + 909;
        setMsgs(p => [...p, { id: intercId, text:'⚙️ Finalizando cadastro...', isAi:true, thinking:true }]);

        // Nível 1: extrai dados da RESPOSTA da IA
        const _extractFromText = (txt) => {
          const d = txt.match(/\b(\d{2}\/\d{2}\/20\d{2})\b/);
          const s = txt.match(/\b(bebida|frios|biscoito|macarrao|macarrão|pesado)\b/i);
          // Nome: tenta vários padrões específicos
          let n = null;
          const pats = [
            /produto\s+([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú0-9\s\-\.]{2,45}?)(?:\s*,|\s+(?:com|de|e|a|até|val|vali|venc|\d))/i,
            /(?:cadastrar?|registrar?|adicionar?|colocar?)\s+(?:o\s+produto\s+)?([A-ZÀ-Úa-zà-ú0-9\s\-\.]{3,45}?)(?:\s+(?:com|de|na|em|até|val|vali|\d))/i,
            /([A-Z]{2}[A-Z0-9\s\-\.]{2,40})\s+(?:cadastrado|registrado|adicionado|salvo)/i,
          ];
          for (const p of pats) { const m = txt.match(p); if (m?.[1]) { n = m[1].trim(); break; } }
          return { validade: d?.[1] || null, prateleira: s?.[1]?.toLowerCase() || null, nome: n ? n.toUpperCase() : null };
        };

        const fromIA   = _extractFromText(raw);
        // Mescla: IA tem precedência em validade corrigida; usuário em nome (mais limpo)
        const bestNome    = userParsed.nome    || fromIA.nome    || null;
        const bestValidade = fromIA.validade   || userParsed.validade || null;
        const bestShelf    = fromIA.prateleira || (bestNome ? _smartResolveShelf(bestNome, null) : _getAllowedShelves()[0]);

        // Nível 2: temos dados suficientes → cadastra DIRETO sem chamar a IA de novo
        if (bestNome && bestValidade) {
          console.log('[JARVIS] Cadastro direto com dados extraídos:', bestNome, bestValidade, bestShelf);
          setMsgs(p => p.filter(m => m.id !== intercId));
          try {
            const r = await jarvisExecuteFn('cadastrar_produto', { nome: bestNome, validade: bestValidade, prateleira: bestShelf });
            const final = String(r || '');
            jarvisHistoryRef.current = [...jarvisHistoryRef.current, { role:'model', parts:[{ text: final }] }];
            return final;
          } catch(e) { console.warn('[JARVIS] cadastro direto falhou:', e.message); }
        }

        // Nível 3: dados insuficientes → força a IA a re-emitir o bloco (última tentativa)
        const rePrompt =
          '[SISTEMA — ACAO IMEDIATA] Voce acabou de descrever um cadastro mas NAO emitiu o bloco de funcao.\n' +
          'DADOS DISPONÍVEIS:\n' +
          (bestNome     ? '• nome: "' + bestNome + '"\n' : '') +
          (bestValidade ? '• validade: "' + bestValidade + '"\n' : '') +
          (bestShelf    ? '• prateleira: "' + bestShelf + '"\n' : '') +
          '\nEmita AGORA apenas:\n' +
          '<<<FN:cadastrar_produto>>>{\"nome\":\"' + (bestNome||'PRODUTO') + '\",\"validade\":\"' + (bestValidade||'01/01/2026') + '\",\"prateleira\":\"' + (bestShelf||_getAllowedShelves()[0]) + '\"}<<<END>>>\n' +
          'NADA MAIS. Apenas o bloco acima.';

        const reHistory = [
          ...jarvisHistoryRef.current,
          { role:'model', parts:[{ text: raw }] },
          { role:'user',  parts:[{ text: rePrompt }] },
        ];
        const reRaw = await _callAIRaw(JARVIS_SYSTEM(), reHistory, 250, 0.05);
        setMsgs(p => p.filter(m => m.id !== intercId));

        const reFn = reRaw?.match(/<<<FN:(\w+)>>>([\s\S]*?)<<<END>>>/);
        if (reFn) {
          try {
            const r = await jarvisExecuteFn(reFn[1], JSON.parse(reFn[2].trim()));
            const final = String(r || '');
            jarvisHistoryRef.current = [...reHistory, { role:'model', parts:[{ text: final }] }];
            return final;
          } catch(e) { console.warn('[JARVIS] re-prompt exec error:', e.message); }
        }

        // Nível 4 (nuclear): se ainda assim não funcionou, cadastra com os melhores dados disponíveis
        if (bestNome || bestValidade) {
          const finalNome    = bestNome     || 'PRODUTO SEM NOME';
          const finalVal     = bestValidade || '01/01/2026';
          const finalShelf   = bestShelf    || _getAllowedShelves()[0];
          try {
            const r = await jarvisExecuteFn('cadastrar_produto', { nome: finalNome, validade: finalVal, prateleira: finalShelf });
            const final = String(r || '');
            jarvisHistoryRef.current = [...reHistory, { role:'model', parts:[{ text: final }] }];
            return final;
          } catch(e) { console.warn('[JARVIS] nível nuclear falhou:', e.message); }
        }

        setMsgs(p => p.filter(m => m.id !== intercId));
      }
    }

    // ── Executa bloco FN se presente ────────────────────────────────────────
    if (fnMatch) {
      try {
        const r = await jarvisExecuteFn(fnMatch[1], JSON.parse(fnMatch[2].trim()));
        if (r) reply = String(r);
      } catch(e) { console.warn('[JARVIS] fn exec error:', e.message); }
    }

    const finalReply = reply || 'Pronto.';
    jarvisHistoryRef.current = [...jarvisHistoryRef.current, { role:'model', parts:[{ text: finalReply }] }];
    return finalReply;
  };



  // ── Extrai blocos <<<UI:KIND>>>{json}<<<END>>> da resposta da IA ───────────
  const _extractUiParts = (text) => {
    const parts = [];
    const re = /<<<UI:(\w+)>>>([\s\S]*?)<<<END>>>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try { parts.push({ kind: m[1], data: JSON.parse(m[2].trim()) }); }
      catch (e) { console.warn('[UI] parse fail', m[1], e.message); }
    }
    const clean = text.replace(/<<<UI:\w+>>>[\s\S]*?<<<END>>>/g, '').trim();
    return { clean, parts };
  };

  // ── Handler central das acoes disparadas pelos botoes UI da IA ─────────────
  const onChatUiAction = (action, value) => {
    if (action === 'set_shelf' && value && SHELVES[value]) {
      setActiveShelf(value); loadStock && loadStock(value);
      setPinnedShelf(value);
      setMsgs(p => [...p, { id: Date.now(), text: `📌 Prateleira fixada: ${shlabel(value)}. Tudo sera cadastrado aqui.`, isAi: true, system: true }]);
    } else if (action === 'pin_shelf') {
      if (activeShelf) {
        setPinnedShelf(activeShelf);
        setMsgs(p => [...p, { id: Date.now(), text: `📌 Prateleira ${shlabel(activeShelf)} fixada.`, isAi: true, system: true }]);
      }
    } else if (action === 'unpin_shelf') {
      setPinnedShelf(null);
      setMsgs(p => [...p, { id: Date.now(), text: '🔓 Prateleira liberada — IA volta a deduzir automaticamente.', isAi: true, system: true }]);
    } else if (action === 'retry') {
      if (value) { setChatTxt(value); setTimeout(() => sendChatRef.current && sendChatRef.current(), 100); }
    }
  };

  // sendChat — modo texto: usa JARVIS
  const sendChat = async () => {
    if (!chatTxt.trim() || chatBusy) return;
    const txt = chatTxt.trim();
    setChatTxt('');
    setMsgs(p => [...p, { id: Date.now(), text: txt, isAi: false }]);
    // IA audaciosa: se detectar algo "errado" na mensagem (ex: data), mostra
    // o modal de progresso e injeta uma mensagem de correção automática.
    maybeAudaciousCorrection(txt);
    setChatBusy(true);
    setJarvisProcessingFlag(true);
    try {
      const replyRaw = await callJarvis(txt, false);
      const { clean: reply, parts: uiParts } = _extractUiParts(replyRaw || '');
      setMsgs(p => [...p, { id: Date.now() + 1, text: reply, isAi: true, uiParts: uiParts.length ? uiParts : undefined }]);
      // Se a resposta indicar que a IA nao entendeu / ficou ambigua, ela mesma
      // monta um prompt mais especifico e reenvia automaticamente apos 3s.
      const lowerReply = (reply || '').toLowerCase();
      const isConfused = lowerReply.includes('nao consegui entender')
        || lowerReply.includes('não consegui entender')
        || lowerReply.includes('pode repetir')
        || lowerReply.includes('nao entendi')
        || lowerReply.includes('não entendi');
      // Só re-tenta se NÃO há intenção clara de cadastro (evita loop de cadastro duplo)
      const txtHasCadastroHint = /(coloc|cadastr|adicion|registr|bot[ao]|lanc)/i.test(txt);
      if (isConfused && !txtHasCadastroHint) {
        const detected = _detectShelfByProduct(txt);
        const hint = detected
          ? `${txt} (categoria: ${shlabel(detected)})`
          : `${txt} — cadastrar na prateleira ${shlabel(activeShelf)}`;
        jarvisSuggestRetry(txt, hint);
      }
    } catch (ex) {
      setMsgs(p => [...p, { id: Date.now() + 1, text: 'Falha na conexao com GEI. Verifique sua internet.', isAi: true }]);
    } finally { setChatBusy(false); setJarvisProcessingFlag(false); }
  };
  useEffect(() => { sendChatRef.current = sendChat; });

  // sendChatVoice — modo voz: usa JARVIS + ElevenLabs fala resposta
  // IMPORTANTE: esta função sempre AGUARDA a fala terminar e NUNCA reinicia
  // o loop do microfone por conta própria — quem reinicia é sempre o
  // jarvisRecordChunk (loop externo), evitando dois "starts" simultâneos
  // (causa do bug de conflito de microfone).
  const sendChatVoice = async (txt, alreadyShown = false) => {
    if (!txt || !txt.trim()) return;
    const clean = txt.trim();
    if (!alreadyShown) setMsgs(p => [...p, { id: Date.now(), text: clean, isAi: false }]);

    // ── Se há um cadastro pendente de confirmação, trata "sim"/"não"/"cancela"
    //    diretamente por voz, sem chamar a IA — evita conflito e perda de contexto.
    if (jarvisConfirmModalRef.current) {
      if (isConfirmCmd(clean)) {
        const { nome, validade, prateleira } = jarvisConfirmModalRef.current;
        const shelf = prateleira || activeShelf;
        const tid = SHELVES[shelf] || SHELVES[activeShelf];
        setJarvisConfirmModal(null);
        if (!tid) {
          await new Promise(res => speakWithElevenLabs('Prateleira nao encontrada.', res));
          return;
        }
        try {
          const dataEnvio = new Date().toLocaleDateString('pt-BR');
          await secureAxiosInstance.post(
            'https://api.baserow.io/api/database/rows/table/' + tid + '/?user_field_names=true',
            { produto: nome, codig: 'Sem EAN', VENCIMENTO: validade, quantidade: '0',
              ENVIADOPORQUEM: (userData && userData.NOME) || 'GEI', PERFILFOTOURL: (userData && userData.PERFILFOTOURL) || '',
              BOLETIM: false, DATAENVIO: dataEnvio, ALERTAMENSAGEM: '', MARGEM: 'Medio giro',
              PREVISAO: calculatePrevisao(0, 'Medio giro', dataEnvio) }
          );
          await addAuditLog('JARVIS_ADD', nome + ' via GEI JARVIS', userData && userData.id);
          if (shelf === activeShelf) loadStock(activeShelf);
          const ok = 'Perfeito. ' + nome + ' cadastrado com validade ' + validade + '.';
          setMsgs(p => [...p, { id: Date.now(), text: ok, isAi: true }]);
          // ── Fecha painel e exibe overlay de sucesso ──────────────────────
          setShowPainelInteligente(false);
          setJarvisVoiceMode(false);
          setTimeout(() => setShowSuccess(true), 320);
          await new Promise(res => speakWithElevenLabs(ok, res));
        } catch {
          await new Promise(res => speakWithElevenLabs('Erro ao salvar. Tente novamente.', res));
        }
        return;
      }
      if (isCancelCmd(clean) || isCorrectCmd(clean)) {
        setJarvisConfirmModal(null);
        await new Promise(res => speakWithElevenLabs('Cancelado.', res));
        return;
      }
      // Se não foi nem confirmação nem cancelamento, pede para repetir.
      const ask = 'Nao entendi. Diga "confirmar" para salvar ou "cancelar" para corrigir.';
      setMsgs(p => [...p, { id: Date.now() + 1, text: ask, isAi: true }]);
      await new Promise(res => speakWithElevenLabs(ask, res));
      return;
    }

    setChatBusy(true);
    setJarvisProcessingFlag(true);
    try {
      const reply = await callJarvis(clean, true);
      setMsgs(p => [...p, { id: Date.now() + 1, text: reply, isAi: true }]);
      
      // ANTI-BUG: Garante que o microfone está desligado enquanto o Jarvis fala
      jarvisLiveRef.current = false;
      
      await new Promise(res => speakWithElevenLabs(reply, res));
      
      // RELIGA O LOOP: Após o Jarvis terminar de falar a resposta, religa o microfone
      if (jarvisLiveRef.liveOn) {
        jarvisLiveRef.current = true;
        setTimeout(jarvisRecordChunk, 500);
      }
    } catch (ex) {
      const msg = 'Falha na conexao. Tente novamente.';
      setMsgs(p => [...p, { id: Date.now() + 1, text: msg, isAi: true }]);
      await new Promise(res => speakWithElevenLabs(msg, res));
      
      if (jarvisLiveRef.liveOn) {
        jarvisLiveRef.current = true;
        setTimeout(jarvisRecordChunk, 500);
      }
    } finally {
      setJarvisProcessingFlag(false);
      setChatBusy(false); 
    }
  };
  const getTargetShelf = () => (isCoord(perf) || isDeposito(perf)) && cadastroShelf ? cadastroShelf : activeShelf;
  const calculatePrevisao = (qtd, giro, dataEnvio) => { const rateMap = { 'Grande giro': 5.2, 'Médio giro': 2.5, 'Pouco giro': 0.8 }; const dailyRate = rateMap[giro] || 2.5; const sendDate = parseDate(dataEnvio) || today(); const remainingDays = dailyRate > 0 ? Math.ceil(qtd / dailyRate) : 999; const depletionDate = addDays(sendDate, remainingDays); return fmtFull(depletionDate); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doSaveProductConfirmed = useCallback(async (overrides = {}) => { const nome = overrides.nome || prodName; const qtdUse = overrides.qty || qtd || '0'; const valUse = overrides.date || validade; const giroUse = overrides.giro || giro || 'Médio giro'; const targetShelf = getTargetShelf(); const tid = SHELVES[targetShelf]; if (!tid) { showErr('Nenhuma prateleira selecionada.'); return; } setBusy(true); setBusyMsg('Salvando produto...'); try { const dataEnvio = new Date().toLocaleDateString('pt-BR'); const previsao = calculatePrevisao(Number(qtdUse), giroUse, dataEnvio); await secureAxiosInstance.post(`https://api.baserow.io/api/database/rows/table/${tid}/?user_field_names=true`, { produto: nome.trim(), codig: scannedEAN || 'Sem EAN', VENCIMENTO: valUse, quantidade: String(qtdUse), ENVIADOPORQUEM: userData?.NOME || 'Sistema', PERFILFOTOURL: userData?.PERFILFOTOURL || '', BOLETIM: false, DATAENVIO: dataEnvio, ALERTAMENSAGEM: '', MARGEM: giroUse, PREVISAO: previsao }); await addAuditLog('PRODUCT_ADDED', `Produto "${nome}" adicionado à prateleira ${targetShelf}`, userData?.id); setBusy(false); setShowSuccess(true); setScannedEAN(''); if (targetShelf === activeShelf) loadStock(activeShelf); } catch (ex) { showErr('Não foi possível salvar.'); setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShelf, loadStock, userData, showErr, prodName, qtd, validade, giro, scannedEAN]);
  const doUpdateExisting = useCallback(async (rowId, overrides) => {
    const tid = SHELVES[getTargetShelf()]; if (!tid || !rowId) return;
    setBusy(true); setBusyMsg('Atualizando produto...');
    try {
      const body = {};
      if (overrides.nome)  body.produto    = overrides.nome.trim();
      if (overrides.qty)   body.quantidade = String(overrides.qty);
      if (overrides.date)  body.VENCIMENTO = overrides.date;
      if (overrides.giro)  body.MARGEM     = overrides.giro;
      await secureAxiosInstance.patch(
        'https://api.baserow.io/api/database/rows/table/' + tid + '/' + rowId + '/?user_field_names=true',
        body
      );
      await addAuditLog('PRODUCT_UPDATED', 'Produto ID ' + rowId + ' atualizado via voz', userData && userData.id);
      setBusy(false); setShowSuccess(true);
      if (getTargetShelf() === activeShelf) loadStock(activeShelf);
    } catch { showErr('Nao foi possivel atualizar.'); setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShelf, loadStock, userData, showErr]);

  const saveProduct = async () => { if (!prodName) { showErr('O nome do produto é obrigatório.'); return; } if (!validade) { showErr('A data de validade é obrigatória.'); return; } if (!isValidDate(validade)) { showErr('Data de validade inválida! Use o formato DD/MM/AAAA e uma data real.'); return; } const eanAtual = scannedEAN && scannedEAN !== 'Sem EAN' ? scannedEAN : null; if (eanAtual) { const duplicado = stockData.find(p => String(p.codig || '').trim() === eanAtual && String(p.VENCIMENTO || '').trim() === validade); if (duplicado) { AppAlert.alert('⚠️ PRODUTO JÁ CADASTRADO', `ESTE PRODUTO JÁ ESTÁ CADASTRADO COM ESTA DATA.\n\nProduto: ${duplicado.produto || prodName}\nCódigo: ${eanAtual}\nValidade: ${validade}\n\nDeseja cadastrar mesmo assim?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cadastrar mesmo assim', style: 'destructive', onPress: doSaveProductConfirmed }]); return; } } await doSaveProductConfirmed(); };
  const nextStep = () => { if (wStep === 1 && !prodName.trim()) { showErr('O nome do produto é obrigatório.'); return; } if (wStep === 2) { if (!validade) { showErr('A data de validade é obrigatória.'); return; } if (!isValidDate(validade)) { showErr('Data inválida! Use o formato DD/MM/AAAA e uma data real.'); return; } } if (wStep < 2) setWStep(p => p + 1); else saveProduct(); };
  const onSuccessDone = () => { setShowSuccess(false); const target = getTargetShelf(); if (target === activeShelf) loadStock(activeShelf); navTo('home'); resetWiz(); setProdName(''); setGiro(''); setCadastroShelf(''); setScannedEAN(''); };
  const navTo = useCallback(tab => { Animated.timing(fadeAnim, { toValue: 0, duration: 110, useNativeDriver: false }).start(() => { setCurrentTab(tab); setScanning(false); Animated.timing(fadeAnim, { toValue: 1, duration: 170, useNativeDriver: false }).start(); }); }, [fadeAnim]);
  const resetWiz = useCallback(() => { setWStep(1); setValidade(''); }, []);
  const viewAuditLogs = async () => { const logs = await getAuditLogs(); const now = new Date(); const last3Days = logs.filter(log => { const logDate = new Date(log.timestamp); const diffMs = now - logDate; return diffMs >= 0 && Math.floor(diffMs / 86400000) <= 3; }); let loginHistory = []; if (userData?.id) { try { const resUser = await secureAxiosInstance.get(`https://api.baserow.io/api/database/rows/table/221009/${userData.id}/?user_field_names=true`); const utimologin = resUser.data?.UTIMOLOGIN || ''; if (utimologin.startsWith('[')) { loginHistory = JSON.parse(utimologin); } else if (utimologin) { loginHistory = [{ data: utimologin, hora: '', iso: '' }]; } } catch (_) { loginHistory = []; } } setAuditLogs({ logs: last3Days, loginHistory }); setShowAuditLogs(true); };
  const enableBiometrics = async (value) => { if (value) { const { isAvailable } = await checkBiometricSupport(); if (!isAvailable) { AppAlert.alert('Biometria não disponível', 'Seu dispositivo não suporta ou não tem biometria configurada.'); return; } const auth = await authenticateWithBiometrics('Confirme para ativar login biométrico'); if (!auth.success) { AppAlert.alert('Falha na autenticação', 'Não foi possível ativar a biometria.'); return; } try { const bioToken = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${userData?.USUARIO}-${Date.now()}-${Math.random()}`); await SafeStore.setItemAsync('bio_token', bioToken); await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${userData?.id}/?user_field_names=true`, { TOKEN_BIOMETRICO: bioToken }); } catch (_) { /* noop */ } } else { try { await SafeStore.deleteItemAsync('bio_token'); if (userData?.id) { await secureAxiosInstance.patch(`https://api.baserow.io/api/database/rows/table/221009/${userData.id}/?user_field_names=true`, { TOKEN_BIOMETRICO: '' }); } } catch (_) { /* noop */ } } setBiometricEnabled(value); await SafeStore.setItemAsync('biometric_enabled', value ? 'true' : 'false'); await addAuditLog(`BIOMETRIC_TOGGLED`, `Biometria ${value ? "ativada" : "desativada"}`, userData?.id); };

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedOut, setLockedOut] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const lockoutTimerRef = useRef(null);
  const startLockout = useCallback(() => { setLockedOut(true); setLockoutRemaining(LOCKOUT_SECS); let remaining = LOCKOUT_SECS; lockoutTimerRef.current = setInterval(() => { remaining -= 1; setLockoutRemaining(remaining); if (remaining <= 0) { clearInterval(lockoutTimerRef.current); setLockedOut(false); setFailedAttempts(0); setLockoutRemaining(0); } }, 1000); }, []);
  useEffect(() => () => { if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current); }, []);
  const sessionTimerRef = useRef(null);
  const resetSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    sessionTimerRef.current = setTimeout(() => {
      if (isLogged) {
        AppAlert.alert('Sessão expirada', 'Sua sessão expirou por inatividade. Faça login novamente.', [{ text: 'OK', onPress: () => { addAuditLog('SESSION_TIMEOUT', 'Sessão expirada por inatividade', userData?.id); oneSignalLogout(); setIsLogged(false); setUserData(null); setEmailIn(''); setPassIn(''); setStockData([]); setActiveShelf(''); setCadastroShelf(''); setPinnedShelf(null); } }]);
      }
    }, SESSION_TIMEOUT_MS);
  }, [isLogged, userData]);
  useEffect(() => {
    if (isLogged) {
      resetSessionTimer();
      const sub = AppState.addEventListener('change', state => { if (state === 'active') resetSessionTimer(); });
      return () => { if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current); sub.remove(); };
    }
  }, [isLogged, resetSessionTimer]);

  useEffect(() => {
    let done = false;
    const forceInit = () => { if (!done) { done = true; setInitialized(true); } };
    const timeout = setTimeout(forceInit, 8000);
    const init = async () => {
      try { await initializeSecureTokens(); await cleanExpiredCache(); } catch (err) { console.error('Erro ao inicializar tokens:', err); showErr('Falha ao obter tokens de segurança. Verifique sua conexão.'); }
      try { const bioPref = await SafeStore.getItemAsync('biometric_enabled'); if (bioPref === 'true') setBiometricEnabled(true); } catch (_) { /* noop */ }
      try { const vhPref = await SafeStore.getItemAsync('voiceIndicatorHidden'); if (vhPref === 'true') setVoiceIndicatorVisible(false); } catch (_) { /* noop */ }
      clearTimeout(timeout); forceInit();
    };
    init();
  }, [showErr]);

  const handleVoiceComplete = useCallback((data) => {
    if (data?.nome) setProdName(data.nome);
    if (data?.qty)  setQtd(data.qty);
    if (data?.date) setValidade(data.date);
    if (data?.giro) setGiro(data.giro || 'Médio giro');
    setWStep(4);
    // Chama com overrides para evitar problema de timing do estado React
    setTimeout(() => doSaveProductConfirmed(data || {}), 300);
  }, [doSaveProductConfirmed, setProdName, setQtd, setValidade, setGiro]);

  if (!initialized) { return (<View style={{ flex: 1, backgroundColor: T.bg, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={T.blue} /><Text style={{ marginTop: 20, color: T.text }}>Inicializando sistema seguro...</Text></View>); }

  if (!isLogged) {
    if (authMode === 'register') { return <RegisterScreen T={T} fontScale={fontScale} onBack={() => setAuthMode('login')} onRegisterSuccess={() => setAuthMode('login')} showErr={showErr} />; }
    if (authMode === 'admin') { return <AdminPanel T={T} fontScale={fontScale} onBack={() => setAuthMode('login')} />; }
    if (authMode === 'qrScanner' && qrStep === 'role') {
      return (
        <View style={{ flex: 1, backgroundColor: T.bg }}>
          <StatusBar hidden />
          <View style={{ paddingTop: 16 }}><ErrBanner msg={erro} onClose={() => setErro('')} /></View>
          <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 26, paddingTop: 60, paddingBottom: 40 }}>
            <Text style={{ fontSize: 56, fontWeight: '900', color: T.text, letterSpacing: -2.5, textAlign: 'center' }}>GEI<Text style={{ color: T.blue }}>.AI</Text></Text>
            <Text style={{ fontSize: 10, letterSpacing: 5, color: T.textSub, marginTop: 6, marginBottom: 40, fontWeight: '700', textAlign: 'center' }}>ACESSO INTELIGENTE</Text>
            <View style={{ backgroundColor: T.bgCard, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: T.border }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: T.text, marginBottom: 6 }}>Selecione a Função</Text>
              <Text style={{ fontSize: 14, color: T.textSub, marginBottom: 20, lineHeight: 20 }}>Defina seu papel antes de ler o QR Code.</Text>
              {ALL_ROLES.map(r => { const on = qrRole === r; const pal = rolePal(T, r); return (<TouchableOpacity key={r} style={[{ flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.bgInput, gap: 12, marginBottom: 10 }, on && { backgroundColor: pal.bg, borderColor: pal.fg + '50' }]} onPress={() => setQrRole(r)}><View style={{ width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: on ? pal.fg : T.bgInput }}><Feather name={pal.icon} size={16} color={on ? '#FFF' : T.textSub} /></View><Text style={[{ fontSize: 16, color: T.textSub, flex: 1 }, on && { color: pal.fg, fontWeight: '800' }]}>{roleLabel(r)}</Text>{on && <Feather name="check-circle" size={18} color={pal.fg} style={{ marginLeft: 'auto' }} />}</TouchableOpacity>); })}
              <PrimaryBtn label="Escanear QR Code" onPress={() => setQrStep('scan')} icon="maximize" style={{ marginTop: 20 }} color={T.blue} />
              <TouchableOpacity style={{ alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 10 }} onPress={() => setAuthMode('login')}><Text style={{ color: T.textSub, fontSize: 15, fontWeight: '600' }}>← Voltar ao login</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      );
    }
    if (authMode === 'qrScanner' && qrStep === 'scan') {
      return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <StatusBar hidden />
          <CameraView style={StyleSheet.absoluteFill} onBarcodeScanned={onQR} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} />
          <View style={{ position: 'absolute', top: 40, left: 24 }}>
            <TouchableOpacity style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setQrStep('role')}>
              <Feather name="arrow-left" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 240, height: 240, borderWidth: 2, borderColor: T.blue, borderRadius: 32, backgroundColor: 'rgba(59,91,255,0.05)' }} />
            <Text style={{ color: '#FFF', marginTop: 24, fontWeight: '800', fontSize: 16 }}>Aponte para o QR Code de acesso</Text>
          </View>
        </View>
      );
    }
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: T.bg }}>
        <StatusBar hidden />
        <View style={{ paddingTop: 16 }}><ErrBanner msg={erro} onClose={() => setErro('')} /></View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 52, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* ── Identidade visual redesenhada: selo circular + wordmark ── */}
          <View style={{ alignItems: 'center', marginBottom: 36 }}>
            <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: T.blueGlow, borderWidth: 1.5, borderColor: T.borderMid, justifyContent: 'center', alignItems: 'center', marginBottom: 18, shadowColor: T.blue, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.22, shadowRadius: 22, elevation: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialCommunityIcons name="cube-scan" size={30} color="#FFF" />
              </View>
            </View>
            <Text style={{ fontSize: 38, fontWeight: '900', color: T.text, letterSpacing: -1.5 }}>GEI<Text style={{ color: T.blue }}>.AI</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: T.bgElevated, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: T.border }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.green }} />
              <Text style={{ fontSize: 11, letterSpacing: 1.5, color: T.textSub, fontWeight: '800' }}>GESTÃO INTELIGENTE DE ESTOQUE</Text>
            </View>
          </View>
          <View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 24, borderWidth: 1, borderColor: T.border, shadowColor: T.accent, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.06, shadowRadius: 24, elevation: 3 }}>
            <Text style={{ fontSize: 21, fontWeight: '900', color: T.text, marginBottom: 4 }}>Bem-vindo de volta</Text>
            <Text style={{ fontSize: 13.5, color: T.textSub, marginBottom: 26, lineHeight: 19 }}>Entre para acompanhar o estoque em tempo real.</Text>
            {lockedOut && (
              <View style={{ backgroundColor: T.redGlow, borderRadius: 20, padding: 18, marginBottom: 20, borderWidth: 1.5, borderColor: T.red + '40', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: T.red + '18', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: T.red }}>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: T.red }}>{lockoutRemaining}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '900', color: T.red, textAlign: 'center' }}>Acesso bloqueado temporariamente</Text>
                  <Text style={{ fontSize: 12.5, color: T.textSub, marginTop: 3, textAlign: 'center' }}>Muitas tentativas incorretas. Aguarde a contagem.</Text>
                </View>
                <View style={{ width: '100%', height: 5, backgroundColor: T.border, borderRadius: 3, overflow: 'hidden' }}><View style={{ height: '100%', backgroundColor: T.red, borderRadius: 3, width: `${(lockoutRemaining / LOCKOUT_SECS) * 100}%` }} /></View>
              </View>
            )}
            {!lockedOut && failedAttempts > 0 && failedAttempts < MAX_LOGIN_ATTEMPTS && (
              <View style={{ backgroundColor: T.amberGlow, borderRadius: 16, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: T.amber + '40', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather name="alert-triangle" size={18} color={T.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: T.amber }}>{failedAttempts}/{MAX_LOGIN_ATTEMPTS} tentativas usadas</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 4 }}>{Array.from({ length: MAX_LOGIN_ATTEMPTS }).map((_, i) => (<View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < failedAttempts ? T.red : T.border }} />))}</View>
              </View>
            )}
            <View style={{ gap: 14, marginBottom: 22 }}>
              <View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: T.textSub, marginBottom: 7, marginLeft: 4, letterSpacing: 0.5 }}>E-MAIL</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border, borderRadius: 16, paddingLeft: 14, opacity: lockedOut ? 0.5 : 1 }}>
                  <Feather name="mail" size={16} color={T.textMuted} />
                  <TextInput style={{ flex: 1, padding: 14, paddingLeft: 10, fontSize: 15, color: T.text }} placeholder="seu@email.com" placeholderTextColor={T.textMuted} value={emailIn} onChangeText={v => setEmailIn(v.toLowerCase())} autoCapitalize="none" keyboardType="email-address" editable={!lockedOut} />
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: T.textSub, marginBottom: 7, marginLeft: 4, letterSpacing: 0.5 }}>SENHA</Text>
                <CapsLockDetector onCapsLockChange={setCapsLockActive}>{({ ref, onKeyPress, isCapsLock }) => (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: isCapsLock ? T.amber : T.border, borderRadius: 16, paddingLeft: 14, paddingRight: 12, opacity: lockedOut ? 0.5 : 1 }}>
                      <Feather name="lock" size={16} color={T.textMuted} />
                      <TextInput ref={ref} style={{ flex: 1, padding: 14, paddingLeft: 10, fontSize: 15, color: T.text }} placeholder="••••••••" placeholderTextColor={T.textMuted} value={passIn} onChangeText={setPassIn} secureTextEntry={!showPass} editable={!lockedOut} onKeyPress={onKeyPress} />
                      <TouchableOpacity onPress={() => setShowPass(!showPass)} disabled={lockedOut}><Feather name={showPass ? 'eye' : 'eye-off'} size={18} color={T.textSub} /></TouchableOpacity>
                    </View>
                    {isCapsLock && (<View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}><Feather name="alert-triangle" size={12} color={T.amber} /><Text style={{ fontSize: 11, color: T.amber, fontWeight: '600' }}>Caps Lock ativado</Text></View>)}
                  </View>
                )}</CapsLockDetector>
              </View>
            </View>
            {loading ? <ActivityIndicator size="large" color={T.blue} style={{ marginVertical: 12 }} /> : <PrimaryBtn label={lockedOut ? `Bloqueado · ${lockoutRemaining}s` : 'Entrar no Painel'} icon={lockedOut ? undefined : 'arrow-right'} onPress={() => doLogin(emailIn, passIn)} color={lockedOut ? T.textMuted : T.blue} style={{ opacity: lockedOut ? 0.6 : 1 }} />}
            {biometricEnabled && !lockedOut && (<TouchableOpacity style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, backgroundColor: T.bgInput, borderRadius: 14 }} onPress={() => doLogin('', '', true)}><Feather name="fingerprint" size={18} color={T.blue} /><Text style={{ color: T.blue, fontWeight: '700', fontSize: 13.5 }}>Entrar com biometria</Text></TouchableOpacity>)}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 22 }}><View style={{ flex: 1, height: 1, backgroundColor: T.border }} /><Text style={{ paddingHorizontal: 14, color: T.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>OU CONTINUE COM</Text><View style={{ flex: 1, height: 1, backgroundColor: T.border }} /></View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', gap: 6, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.bgInput }} onPress={() => setAuthMode('qrScanner')}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="maximize" size={17} color={T.blue} /></View>
                <Text style={{ color: T.text, fontWeight: '700', fontSize: 12.5 }}>QR Code</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', gap: 6, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.bgInput }} onPress={() => setAuthMode('register')}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.purpleGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="user-plus" size={17} color={T.purple} /></View>
                <Text style={{ color: T.text, fontWeight: '700', fontSize: 12.5 }}>Cadastrar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', gap: 6, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.bgInput }} onPress={() => setAuthMode('admin')}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.orangeGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="shield" size={17} color={T.orange} /></View>
                <Text style={{ color: T.text, fontWeight: '700', fontSize: 12.5 }}>Admin</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={{ alignSelf: 'center', marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setShowRastreioModal(true)}><Feather name="search" size={14} color={T.textSub} /><Text style={{ color: T.textSub, fontSize: 12.5, fontWeight: '600' }}>Verificar acesso com código de rastreio</Text></TouchableOpacity>
          </View>
          <Text style={{ marginTop: 28, textAlign: 'center', color: T.textMuted, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5 }}>GEI.AI v6.0 Aurora · 2026</Text>
        </ScrollView>
        <RastreioModal visible={showRastreioModal} onClose={() => setShowRastreioModal(false)} T={T} fontScale={fontScale} />
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar hidden />
      <DarkTorchPrompt isDarkEnv={isDarkEnv} lightLevel={lightLevel} torchOn={torchOn} onToggleTorch={() => setTorchOn(!torchOn)} T={T} fontScale={fontScale} />
      <Modal visible={showQrGenerator} transparent animationType="fade" onRequestClose={() => setShowQrGenerator(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center' }}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowQrGenerator(false)} /><View style={{ backgroundColor: T.bgCard, borderRadius: 32, margin: 20, maxHeight: '85%', borderWidth: 1, borderColor: T.border }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: T.border }}><Text style={{ fontSize: 20 * fontScale, fontWeight: '900', color: T.text }}>QR Code de Acesso</Text><TouchableOpacity onPress={() => setShowQrGenerator(false)} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center' }}><Feather name="x" size={20} color={T.textSub} /></TouchableOpacity></View><QrCodeGenerator T={T} fontScale={fontScale} userData={userData} onClose={() => setShowQrGenerator(false)} /></View></View></Modal>
      <Modal visible={showAuditLogs} transparent animationType="fade" onRequestClose={() => setShowAuditLogs(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-start', paddingTop: 52 }}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAuditLogs(false)} /><View style={{ backgroundColor: T.bgCard, borderRadius: 32, margin: 16, maxHeight: WIN.height * 0.99, borderWidth: 1, borderColor: T.border }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderColor: T.border }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.blue + '40' }}><Feather name="shield" size={18} color={T.blue} /></View><View><Text style={{ fontSize: 16 * fontScale, fontWeight: '900', color: T.text }}>Auditoria & Logins</Text><Text style={{ fontSize: 11 * fontScale, color: T.textSub, fontWeight: '600' }}>Últimos 3 dias</Text></View></View><TouchableOpacity onPress={() => setShowAuditLogs(false)} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}><Feather name="x" size={18} color={T.textSub} /></TouchableOpacity></View><ScrollView contentContainerStyle={{ padding: 16, gap: 8 }} showsVerticalScrollIndicator={false}>{auditLogs.loginHistory && auditLogs.loginHistory.length > 0 && (<View style={{ backgroundColor: T.bgElevated, borderRadius: 18, padding: 16, marginBottom: 4, borderWidth: 1.5, borderColor: T.blue + '35' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.blue + '40' }}><Feather name="log-in" size={14} color={T.blue} /></View><Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: T.blue, textTransform: 'uppercase', letterSpacing: 0.8 }}>Histórico de Logins</Text><View style={{ marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: T.blue + '18', borderWidth: 1, borderColor: T.blue + '30' }}><Text style={{ fontSize: 10 * fontScale, fontWeight: '900', color: T.blue }}>{auditLogs.loginHistory.length} registro{auditLogs.loginHistory.length !== 1 ? 's' : ''}</Text></View></View>{auditLogs.loginHistory.map((login, idx) => (<View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: idx > 0 ? 1 : 0, borderColor: T.border }}><View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: idx === 0 ? T.green + '20' : T.bgInput, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: idx === 0 ? T.green + '50' : T.border }}><Text style={{ fontSize: 11, fontWeight: '900', color: idx === 0 ? T.green : T.textMuted }}>#{idx + 1}</Text></View><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{idx === 0 && (<View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: T.green + '18', borderWidth: 1, borderColor: T.green + '40' }}><Text style={{ fontSize: 9 * fontScale, fontWeight: '900', color: T.green }}>MAIS RECENTE</Text></View>)}<Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: idx === 0 ? T.text : T.textSub }}>{login.data || '—'}{login.hora ? `  ·  ${login.hora}` : ''}</Text></View>{login.iso ? (<Text style={{ fontSize: 10 * fontScale, color: T.textMuted, marginTop: 2, fontWeight: '600' }}>{new Date(login.iso).toLocaleString('pt-BR', { weekday: 'long' })}</Text>) : null}</View><Feather name={idx === 0 ? 'check-circle' : 'clock'} size={15} color={idx === 0 ? T.green : T.textMuted} /></View>))}</View>)}<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 }}><View style={{ flex: 1, height: 1, backgroundColor: T.border }} /><Text style={{ fontSize: 10 * fontScale, fontWeight: '800', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>Eventos do Sistema</Text><View style={{ flex: 1, height: 1, backgroundColor: T.border }} /></View>{(!auditLogs.logs || auditLogs.logs.length === 0) ? (<View style={{ alignItems: 'center', paddingVertical: 32 }}><Feather name="check-circle" size={36} color={T.green} /><Text style={{ textAlign: 'center', color: T.textSub, marginTop: 12, fontSize: 14 * fontScale, fontWeight: '700' }}>Nenhum evento nos últimos 3 dias.</Text></View>) : (auditLogs.logs.map((log, index) => { const isLogin = log.action?.includes('LOGIN') || log.action?.includes('QR'); const isWarning = log.action?.includes('FAILED') || log.action?.includes('DENIED') || log.action?.includes('ERROR') || log.action?.includes('INVALID'); const iconName = isWarning ? 'alert-triangle' : isLogin ? 'log-in' : 'activity'; const iconColor = isWarning ? T.amber : isLogin ? T.blue : T.teal; const bgColor = isWarning ? T.amberGlow : isLogin ? T.blueGlow : T.tealGlow; const borderColor = isWarning ? T.amber + '40' : isLogin ? T.blue + '30' : T.teal + '30'; return (<View key={index} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: T.bgElevated, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: borderColor }}><View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: bgColor, justifyContent: 'center', alignItems: 'center', marginTop: 1, borderWidth: 1, borderColor: borderColor }}><Feather name={iconName} size={13} color={iconColor} /></View><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}><Text style={{ fontSize: 12 * fontScale, fontWeight: '900', color: iconColor, flex: 1, paddingRight: 8 }}>{log.action}</Text><Text style={{ fontSize: 9 * fontScale, color: T.textMuted, fontWeight: '700', flexShrink: 0 }}>{new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text></View><Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 3, lineHeight: 16 }}>{log.details}</Text><Text style={{ fontSize: 9 * fontScale, color: T.textMuted, marginTop: 4, fontWeight: '600' }}>{new Date(log.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}{log.userId ? `  ·  ID ${log.userId}` : ''}</Text></View></View>); }))}</ScrollView></View></View></Modal>
      {!scanning && (
        <View style={{ paddingTop: 50, paddingHorizontal: 20, paddingBottom: 18, backgroundColor: T.bg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 20, padding: 2, backgroundColor: T.blueGlow }}>
              {userData?.PERFILFOTOURL ? (
                <Image source={{ uri: userData.PERFILFOTOURL }} style={{ width: '100%', height: '100%', borderRadius: 18 }} />
              ) : (
                <View style={{ width: '100%', height: '100%', borderRadius: 18, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '900' }}>{initials}</Text>
                </View>
              )}
              <View style={{ position: 'absolute', bottom: -1, right: -1, width: 15, height: 15, borderRadius: 8, backgroundColor: T.green, borderWidth: 2, borderColor: T.bg }} />
            </View>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontWeight: '900', color: T.text, fontSize: 19 * fontScale, letterSpacing: -0.4 }} numberOfLines={1}>{userData?.NOME || 'Usuário'}</Text>
              <Text style={{ color: T.textSub, fontSize: 12 * fontScale, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>Painel de estoque inteligente</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(canSw || isDeposito(perf)) && (<TouchableOpacity style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }} onPress={() => setShelfModal(true)}><Feather name="layers" size={17} color={T.blue} /></TouchableOpacity>)}
              <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: T.redGlow, justifyContent: 'center', alignItems: 'center' }} onPress={() => { addAuditLog('LOGOUT', 'Usuário fez logout', userData?.id); oneSignalLogout(); setIsLogged(false); setUserData(null); setEmailIn(''); setPassIn(''); setStockData([]); setActiveShelf(''); setCadastroShelf(''); setCleanToast(null); setFailedAttempts(0); setLockedOut(false); if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current); }}><Feather name="log-out" size={17} color={T.red} /></TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {currentTab === 'home' && !scanning && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_SAFE + 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* ── Hero card redesenhado: bloco único com selo de prateleira no canto ── */}
            <View style={{ backgroundColor: T.bgCard, borderRadius: 26, padding: 22, marginBottom: 18, borderWidth: 1, borderColor: T.border, shadowColor: T.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.07, shadowRadius: 22, elevation: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={{ color: T.textSub, fontSize: 12 * fontScale, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' }}>Itens ativos</Text>
                  <Text style={{ color: T.text, fontSize: 46 * fontScale, fontWeight: '900', letterSpacing: -2, marginTop: 4 }}>{stockData.length}</Text>
                </View>
                <View style={{ backgroundColor: shPal.glow, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: shPal.accent + '40', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name={shPal.icon} size={12} color={shPal.accent} />
                  <Text style={{ color: shPal.accent, fontSize: 12 * fontScale, fontWeight: '800' }}>{shlabel(activeShelf)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, paddingVertical: 13, borderWidth: 1, borderColor: T.blue + '35', backgroundColor: T.blueGlow }} onPress={() => navTo('estoque')}>
                  <Feather name="layers" size={16} color={T.blue} /><Text style={{ fontWeight: '800', fontSize: 13 * fontScale, color: T.blue }}>Ver Estoque</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, paddingVertical: 13, borderWidth: 1, borderColor: T.teal + '35', backgroundColor: T.tealGlow }} onPress={() => navTo('chat')}>
                  <Feather name="message-circle" size={16} color={T.teal} /><Text style={{ fontWeight: '800', fontSize: 13 * fontScale, color: T.teal }}>Falar com IA</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ShelfQuickSelector current={cadastroShelf || activeShelf} onOpen={isRepositor(perf) ? undefined : () => setShelfModal(true)} T={T} fontScale={fontScale} title={canSw || isDeposito(perf) ? 'Troca rápida de prateleira' : 'Sua prateleira ativa'} subtitle={isRepositor(perf) ? 'Sua prateleira é definida pelo coordenador.' : canSw || isDeposito(perf) ? 'Toque para trocar a prateleira' : 'Visualize a prateleira atual.'} />
            {counts.expired > 0 && <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12, borderColor: T.red + '50', backgroundColor: T.redGlow }} onPress={() => { setActiveFilter('expired'); navTo('estoque'); }}><Feather name="alert-circle" size={20} color={T.red} /><View style={{ flex: 1 }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.red }}>{counts.expired} produto{counts.expired !== 1 ? 's' : ''} vencido{counts.expired !== 1 ? 's' : ''}!</Text><Text style={{ fontSize: 12 * fontScale, color: T.red, opacity: 0.8, marginTop: 2 }}>Toque para ver e gerenciar</Text></View><Feather name="arrow-right" size={16} color={T.red} /></TouchableOpacity>}
            {counts.warning > 0 && <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12, borderColor: T.amber + '50', backgroundColor: T.amberGlow }} onPress={() => { setActiveFilter('warning'); navTo('estoque'); }}><Feather name="alert-triangle" size={20} color={T.amber} /><View style={{ flex: 1 }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.amber }}>{counts.warning} produto{counts.warning !== 1 ? 's' : ''} vence{counts.warning !== 1 ? 'm' : ''} em 7 dias</Text><Text style={{ fontSize: 12 * fontScale, color: T.amber, opacity: 0.8, marginTop: 2 }}>Atenção imediata necessária</Text></View><Feather name="arrow-right" size={16} color={T.amber} /></TouchableOpacity>}
            <TouchableOpacity onPress={() => setShowExpiryModal(true)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16, gap: 12, borderColor: T.orange + '40', backgroundColor: T.orangeGlow }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.orange + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.orange + '40' }}><Feather name="calendar" size={18} color={T.orange} /></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.orange }}>📅 Vencimentos por Mês</Text><Text style={{ fontSize: 12 * fontScale, color: T.orange, opacity: 0.75, marginTop: 1 }}>Veja produtos que vencem nos próximos 30 dias</Text></View>
              <Feather name="chevron-right" size={16} color={T.orange} />
            </TouchableOpacity>
            <TouchableOpacity onPress={triggerAutoClean} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16, gap: 12, borderColor: T.purple + '40', backgroundColor: T.purpleGlow }}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.purple + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.purple + '40' }}><Feather name="trash-2" size={18} color={T.purple} /></View><View style={{ flex: 1 }}><Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.purple }}>Limpar produtos vencidos</Text><Text style={{ fontSize: 12 * fontScale, color: T.purple, opacity: 0.75, marginTop: 1 }}>Remove itens com +30 dias de vencimento</Text></View><Feather name="arrow-right" size={16} color={T.purple} /></TouchableOpacity>
            <Text style={{ fontSize: 15 * fontScale, fontWeight: '900', color: T.text, letterSpacing: -0.2, marginBottom: 16, textTransform: 'uppercase' }}>Painel de Ações</Text>
            {(isDeposito(perf) || isCoord(perf)) && <ActionCard T={T} fontScale={fontScale} icon="layers" color={T.orange} title="Gerenciar Prateleiras" desc={`Prateleira atual: ${shlabel(activeShelf)}`} badge={shlabel(activeShelf)} onPress={() => setShelfModal(true)} />}
            <ActionCard T={T} fontScale={fontScale} icon="edit-3" color={shPal.accent} title="Cadastrar Produto" desc={`Destino: ${shlabel(cadastroShelf || activeShelf)}`} badge={shlabel(cadastroShelf || activeShelf)} onPress={() => { resetWiz(); setProdName(''); setGiro(''); navTo('cadastro'); }} />
            <ActionCard T={T} fontScale={fontScale} icon="maximize" color={T.blue} title="Leitura de Código de Barras" desc="Preenche o nome automaticamente via IA" onPress={() => startScan('barcode')} />
            <ActionCard T={T} fontScale={fontScale} icon="camera" color={T.purple} title="Scanner IA Vision" desc="Identifique produtos via foto" onPress={() => startScan('aiVision')} />
            <ActionCard T={T} fontScale={fontScale} icon="box" color={T.teal} title="🏗️ Calculadora de Pinhas" desc="Simule e calcule pilhas de produtos visualmente" onPress={() => setShowPinhasModal(true)} />
            <ActionCard T={T} fontScale={fontScale} icon="settings" color={T.textSub} title="Configurações do App" desc="Aparência, fonte e automações" onPress={() => navTo('config')} />
            {/* ── Grupo de atalhos IA — unificado em um único bloco coeso ── */}
            <View style={{ backgroundColor: T.bgCard, borderRadius: 22, borderWidth: 1, borderColor: T.border, marginTop: 6, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 }}>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>Atalhos de Inteligência Artificial</Text>
              </View>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, gap: 12, borderTopWidth: 1, borderColor: T.border }} onPress={() => setVoiceAssistantVisible(true)}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.blueGlow, justifyContent: 'center', alignItems: 'center' }}><Feather name="mic" size={18} color={T.blue} /></View>
                <Text style={{ flex: 1, fontSize: 14 * fontScale, fontWeight: '800', color: T.text }}>Assistente de Voz</Text>
                <Feather name="chevron-right" size={16} color={T.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, gap: 12, borderTopWidth: 1, borderColor: T.border }} onPress={() => { setJarvisInitialTab('novidades'); setShowPainelInteligente(true); }}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.purpleGlow, justifyContent: 'center', alignItems: 'center' }}><MaterialCommunityIcons name="robot-excited-outline" size={19} color={T.purple} /></View>
                <Text style={{ flex: 1, fontSize: 14 * fontScale, fontWeight: '800', color: T.text }}>Novidades do Estoque</Text>
                <Feather name="chevron-right" size={16} color={T.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, gap: 12, borderTopWidth: 1, borderColor: T.border }} onPress={() => { setJarvisInitialTab('painel'); setShowPainelInteligente(true); }}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center' }}><MaterialCommunityIcons name="brain" size={19} color={T.teal} /></View>
                <Text style={{ flex: 1, fontSize: 14 * fontScale, fontWeight: '800', color: T.text }}>Painel Inteligente</Text>
                {detectFifoGroups(stockData).hasFifo && (<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.teal, marginRight: 4 }} />)}
                <Feather name="chevron-right" size={16} color={T.textMuted} />
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
        {currentTab === 'chat' && <ChatScreen T={T} fontScale={fontScale} msgs={msgs} chatTxt={chatTxt} setChatTxt={setChatTxt} sendChat={sendChat} sendChatVoice={sendChatVoice} busy={chatBusy} scrollRef={scrollRef} TAB_H={TAB_H} NAV_BAR_H={NAV_BAR_H} onVoiceMode={setJarvisVoiceMode} jarvisRecording={jarvisRecording} jarvisProcessing={jarvisProcessing} jarvisBusy={chatBusy} onProgressDone={closeJarvisProgress} activeShelf={activeShelf} pinnedShelf={pinnedShelf} setPinnedShelf={setPinnedShelf} shlabel={shlabel} SHELF_KEYS={SHELF_KEYS} SHELVES={SHELVES} onUiAction={onChatUiAction} />}
        {currentTab === 'cadastro' && (
          <>
            <CadastroScreen T={T} fontScale={fontScale} perf={perf} cadastroShelf={cadastroShelf} setCadastroShelf={setCadastroShelf} activeShelf={activeShelf} prodName={prodName} setProdName={setProdName} validade={validade} setValidade={setValidade} wStep={wStep} setWStep={setWStep} nextStep={nextStep} saveProduct={saveProduct} TAB_SAFE={TAB_SAFE} isCoord={isCoord} isDeposito={isDeposito} SHELF_KEYS={SHELF_KEYS} shlabel={shlabel} shelfPalette={shelfPalette} showErr={showErr} />
            <TouchableOpacity style={{ position: 'absolute', bottom: TAB_SAFE + 20, right: 20, backgroundColor: T.blue, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', shadowColor: T.blue, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 }} onPress={() => setVoiceAssistantVisible(true)}>
              <Feather name="mic" size={28} color="#FFF" />
            </TouchableOpacity>
          </>
        )}
        {currentTab === 'estoque' && (
          <View style={{ flex: 1 }}>
            {/* PATCH: Overlay animado "Montando estoque" forcado apos cadastro IA */}
            {estoqueBuilding.visible && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, backgroundColor: T.bg + 'F0', justifyContent: 'center', alignItems: 'center', padding: 24 }} pointerEvents="auto">
                <View style={{ width: '100%', maxWidth: 380, backgroundColor: T.bgCard, borderRadius: 28, padding: 24, borderWidth: 2, borderColor: T.blue + '60', shadowColor: T.blue, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <ActivityIndicator size="small" color={T.blue} />
                    <Text style={{ flex: 1, fontSize: 12 * fontScale, fontWeight: '900', color: T.blue, letterSpacing: 1.2, textTransform: 'uppercase' }}>Montando Estoque...</Text>
                  </View>
                  {/* Skeleton de 3 cards "construindo" */}
                  {[0,1,2].map(i => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10, backgroundColor: T.bgInput, borderRadius: 14, borderWidth: 1, borderColor: T.border, opacity: i === 0 ? 1 : 0.45 - (i*0.1) }}>
                      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: i === 0 ? T.blueGlow : T.border, justifyContent: 'center', alignItems: 'center' }}>
                        {i === 0 ? <Feather name="check" size={20} color={T.blue} /> : <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: T.borderMid }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13 * fontScale, fontWeight: '900', color: i === 0 ? T.text : T.textMuted }} numberOfLines={1}>{i === 0 ? (estoqueBuilding.produto || 'Produto') : ' '}</Text>
                        <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 3 }}>{i === 0 ? ('Validade ' + (estoqueBuilding.validade || '—') + ' · ' + shlabel(estoqueBuilding.shelf || activeShelf)) : ' '}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={{ marginTop: 6, padding: 12, borderRadius: 12, backgroundColor: T.greenGlow, borderWidth: 1, borderColor: T.green + '50' }}>
                    <Text style={{ fontSize: 12 * fontScale, fontWeight: '800', color: T.green, textAlign: 'center' }}>✅ Produto adicionado pela IA · sincronizando...</Text>
                  </View>
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8, backgroundColor: T.bgCard, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 }}>
              <FlatList horizontal showsHorizontalScrollIndicator={false} data={FILTERS} keyExtractor={f => f.key} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }} renderItem={({ item: f }) => { const on = activeFilter === f.key; const fc2 = fcol[f.colorKey]; const cnt = counts[f.key]; return (<TouchableOpacity style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 22, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border }, on && { backgroundColor: fc2, borderColor: fc2 }]} onPress={() => setActiveFilter(f.key)}><Feather name={f.icon} size={13} color={on ? '#FFF' : T.textSub} /><Text style={[{ fontSize: 13 * fontScale, fontWeight: '700', color: T.textSub }, on && { color: '#FFF', fontWeight: '800' }]}>{f.label}</Text>{cnt > 0 && <View style={{ minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, justifyContent: 'center', alignItems: 'center', backgroundColor: on ? 'rgba(255,255,255,0.3)' : T.borderMid }}><Text style={{ fontSize: 10, fontWeight: '900', color: on ? '#FFF' : T.textSub }}>{cnt}</Text></View>}</TouchableOpacity>); }} />
              <View style={{ flexDirection: 'row', gap: 6, marginLeft: 8 }}><TouchableOpacity style={[{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border, justifyContent: 'center', alignItems: 'center' }, searchOpen && { backgroundColor: T.blue, borderColor: T.blue }]} onPress={() => { setSearchOpen(o => !o); if (searchOpen) setSearchQuery(''); }}><Feather name="search" size={16} color={searchOpen ? '#FFF' : T.textSub} /></TouchableOpacity>{['list', 'grid'].map(m => (<TouchableOpacity key={m} style={[{ width: 38, height: 38, borderRadius: 13, backgroundColor: T.bgInput, borderWidth: 1, borderColor: T.border, justifyContent: 'center', alignItems: 'center' }, viewMode === m && { backgroundColor: T.blue, borderColor: T.blue }]} onPress={() => setViewMode(m)}><Feather name={m} size={16} color={viewMode === m ? '#FFF' : T.textSub} /></TouchableOpacity>))}</View>
            </View>
            {searchOpen && (<View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: T.bgCard, borderBottomWidth: 1, borderColor: T.border }}><View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgInput, borderRadius: 16, borderWidth: 1.5, borderColor: T.blue + '60', paddingHorizontal: 14, gap: 10 }}><Feather name="search" size={16} color={T.blue} /><TextInput style={{ flex: 1, paddingVertical: 12, fontSize: 15 * fontScale, color: T.text }} placeholder="Buscar produto pelo nome..." placeholderTextColor={T.textMuted} value={searchQuery} onChangeText={setSearchQuery} autoFocus clearButtonMode="while-editing" />{searchQuery.length > 0 && (<TouchableOpacity onPress={() => setSearchQuery('')}><Feather name="x" size={16} color={T.textMuted} /></TouchableOpacity>)}</View></View>)}
            <FlatList key={viewMode} data={filteredStock} keyExtractor={(item, index) => `${item.id}-${index}`} numColumns={viewMode === 'grid' ? 2 : 1} columnWrapperStyle={viewMode === 'grid' ? { gap: 12 } : undefined} renderItem={({ item }) => viewMode === 'list' ? <CardList item={item} T={T} fontScale={fontScale} onPress={setSelectedProduct} fifoMode={fifoMode} allProducts={stockData} /> : <CardGrid item={item} T={T} fontScale={fontScale} onPress={setSelectedProduct} fifoMode={fifoMode} allProducts={stockData} />} contentContainerStyle={{ padding: 16, paddingBottom: TAB_SAFE + 24 }} showsVerticalScrollIndicator={false} ListEmptyComponent={() => (<View style={{ alignItems: 'center', paddingVertical: 80 }}><Feather name={searchQuery ? 'search' : 'inbox'} size={60} color={T.textMuted} /><Text style={{ color: T.textSub, marginTop: 20, fontSize: 17 * fontScale, fontWeight: '800', textAlign: 'center' }}>{searchQuery ? 'Nenhum resultado' : 'Nada aqui...'}</Text><Text style={{ color: T.textMuted, marginTop: 8, fontSize: 14 * fontScale, fontWeight: '600', textAlign: 'center' }}>{searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : activeFilter === 'all' ? 'Nenhum produto cadastrado nesta prateleira.' : 'Nenhum produto atende a este filtro.'}</Text></View>)} />
          </View>
        )}
        {currentTab === 'config' && <ConfigScreen T={T} currentTheme={currentTheme} onThemeChange={setCurrentTheme} fontScale={fontScale} setFontScale={setFontScale} notifOn={notifOn} setNotifOn={setNotifOn} TAB_SAFE={TAB_SAFE} onGenerateQR={() => setShowQrGenerator(true)} onViewAuditLogs={viewAuditLogs} onEnableBiometrics={enableBiometrics} biometricEnabled={biometricEnabled} onChangePassword={handleChangePassword} userData={userData} fifoMode={fifoMode} setFifoMode={setFifoMode} micSoundEnabled={micSoundEnabled} setMicSoundEnabled={updateMicSound} micVibrationEnabled={micVibrationEnabled} setMicVibrationEnabled={updateMicVibration} micSoundVolume={micSoundVolume} setMicSoundVolume={updateMicVolume} voiceRecognitionEnabled={voiceRecognitionEnabled} setVoiceRecognitionEnabled={updateVoiceRecognition} elevenLabsQuota={elevenLabsQuota} onFetchQuota={async () => { const quota = await fetchElevenLabsQuota(); setElevenLabsQuota(quota); if (!quota) AppAlert.alert('Erro', 'Não foi possível buscar as cotas do ElevenLabs.'); }} />}
      </Animated.View>
      {/* ══════════════════════════════════════════════════════════════
           SCANNER PREMIUM — Barcode + AI Vision + Animações
      ══════════════════════════════════════════════════════════════ */}
      <ScannerModalPremium
        visible={scanning}
        scanMode={scanMode}
        camRef={camRef}
        torchOn={torchOn}
        setTorchOn={setTorchOn}
        onBarcode={onBarcode}
        onClose={() => { setScanning(false); setCountdown(null); setTorchOn(false); setShowAchandoGif(false); aiVisionTriggeredRef.current = false; if (gifTimeoutRef.current) clearTimeout(gifTimeoutRef.current); }}
        onAIVisionCameraReady={onAIVisionCameraReady}
        showAchandoGif={showAchandoGif}
        T={T}
        isDarkEnv={isDarkEnv}
        fontScale={fontScale}
        scanAnim={scanAnim}
        pulseAnim={pulseAnim}
      />
      {/* PATCH: Modal "IA pensando" — digita prompts inteligentes ao vivo */}
      <Modal visible={smartCadastro.visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setSmartCadastro(s => ({ ...s, visible: false }))}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', padding: 18 }}>
          <View style={{ width: '100%', maxWidth: 420, backgroundColor: T.bgCard, borderRadius: 28, padding: 22, borderWidth: 2, borderColor: T.purple + '70', shadowColor: T.purple, shadowOpacity: 0.5, shadowRadius: 30, elevation: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.purpleGlow, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: T.purple + '60' }}>
                <MaterialCommunityIcons name="brain" size={20} color={T.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.purple, letterSpacing: 1.2, textTransform: 'uppercase' }}>GEI.IA · Pensando</Text>
                <Text style={{ fontSize: 14 * fontScale, fontWeight: '800', color: T.text }}>Digitando prompts inteligentes...</Text>
              </View>
              {!smartCadastro.done && <ActivityIndicator size="small" color={T.purple} />}
            </View>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {(smartCadastro.typedSteps || []).map((step, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6, backgroundColor: T.bgInput, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: T.purple + '90' }}>
                  <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '600', flex: 1 }}>{step}</Text>
                </View>
              ))}
              {smartCadastro.typedSteps.length < (smartCadastro.steps || []).length && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 13 * fontScale, color: T.textMuted, fontStyle: 'italic' }}>▍</Text>
                </View>
              )}
            </ScrollView>
            {smartCadastro.done && smartCadastro.produto && (
              <View style={{ marginTop: 10, padding: 12, backgroundColor: T.blueGlow, borderRadius: 14, borderWidth: 1, borderColor: T.blue + '50' }}>
                <Text style={{ fontSize: 11 * fontScale, fontWeight: '900', color: T.blue, marginBottom: 4, letterSpacing: 0.8 }}>RESUMO IA</Text>
                <Text style={{ fontSize: 13 * fontScale, color: T.text, fontWeight: '800' }}>{smartCadastro.produto.nome || '—'}</Text>
                <Text style={{ fontSize: 11 * fontScale, color: T.textSub, marginTop: 2 }}>
                  {(smartCadastro.produto.marca || '?')} · {(smartCadastro.produto.gramatura || '?')} · EAN {(smartCadastro.produto.ean || '— pendente')}
                </Text>
                {smartCadastro.pergunta ? (
                  <Text style={{ fontSize: 12 * fontScale, color: T.amber, marginTop: 8, fontWeight: '700' }}>❓ {smartCadastro.pergunta}</Text>
                ) : null}
              </View>
            )}
            <TouchableOpacity onPress={() => setSmartCadastro(s => ({ ...s, visible: false }))} style={{ marginTop: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: T.bgInput, alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
              <Text style={{ fontSize: 13 * fontScale, fontWeight: '800', color: T.textSub }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════
           IA Vision "Produto Identificado" — Modal Premium
      ══════════════════════════════════════════════════════════════ */}
      <Modal visible={showRoboGif} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <RoboGifPremium roboMsg={roboMsg} T={T} fontScale={fontScale} />
      </Modal>
      {!scanning && (
        <View style={{ height: TAB_H, backgroundColor: T.bgCard, borderTopWidth: 1, borderColor: T.border, borderTopLeftRadius: 26, borderTopRightRadius: 26, flexDirection: 'row', paddingBottom: NAV_BAR_H, paddingHorizontal: 8, shadowColor: T.accent, shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 8 }}>
          <TabBtn icon="home" label="Início" active={currentTab === 'home'} onPress={() => navTo('home')} T={T} fontScale={fontScale} />
          <TabBtn icon="layers" label="Estoque" active={currentTab === 'estoque'} onPress={() => navTo('estoque')} T={T} fontScale={fontScale} />
          <View style={{ flex: 1.2, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 66, height: 66, borderRadius: 24, backgroundColor: T.bg, marginTop: -30, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: T.border }}>
              <TouchableOpacity activeOpacity={0.9} style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: T.blue, justifyContent: 'center', alignItems: 'center', shadowColor: T.blue, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 10 }} onPress={() => { resetWiz(); setProdName(''); setGiro(''); navTo('cadastro'); }}>
                <Feather name="plus" size={26} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
          <TabBtn icon="message-circle" label="IA Chat" active={currentTab === 'chat'} onPress={() => navTo('chat')} T={T} fontScale={fontScale} />
          <TabBtn icon="settings" label="Ajustes" active={currentTab === 'config'} onPress={() => navTo('config')} T={T} fontScale={fontScale} />
        </View>
      )}
      {/* ── Botão flutuante JARVIS — qualquer tela ─────────────────────────── */}
      {!scanning && (
        <TouchableOpacity
          onPress={() => {
            setJarvisVoiceMode(p => {
              const next = !p;
              if (next) setShowPainelInteligente(true);
              else setShowPainelInteligente(false);
              return next;
            });
          }}
          style={{ position: 'absolute', right: 18, bottom: TAB_SAFE + 16,
            width: 56, height: 56, borderRadius: 19,
            backgroundColor: jarvisVoiceMode ? T.teal : T.bgCard,
            justifyContent: 'center', alignItems: 'center', elevation: 16,
            shadowColor: jarvisVoiceMode ? T.teal : '#000',
            shadowOpacity: jarvisVoiceMode ? 0.6 : 0.15, shadowRadius: 16,
            borderWidth: 2.5, borderColor: jarvisVoiceMode ? T.teal : T.border }}
          activeOpacity={0.85}>
          {jarvisRecording
            ? <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center', height: 24 }}>
                {jarvisWaveAnims.map((a, i) => (
                  <Animated.View key={i} style={{ width: 3.5, height: 20, borderRadius: 2, backgroundColor: '#fff', transform: [{ scaleY: a }] }} />
                ))}
              </View>
            : jarvisProcessing
              ? <ActivityIndicator size="small" color={jarvisVoiceMode ? '#fff' : T.teal} />
              : <MaterialCommunityIcons name="robot-outline" size={26} color={jarvisVoiceMode ? '#fff' : T.teal} />
          }
        </TouchableOpacity>
      )}

      {/* ── Modal de confirmação de cadastro JARVIS ───────────────────────── */}
      <Modal visible={!!jarvisConfirmModal} transparent animationType="slide" onRequestClose={() => setJarvisConfirmModal(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setJarvisConfirmModal(null); if (jarvisLiveRef.liveOn && !jarvisLiveRef.current) { jarvisLiveRef.current = true; jarvisRecordChunk(); } }} />
          <View style={{ backgroundColor: T.bgCard, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 28, paddingBottom: 28 + NAV_BAR_H, borderTopWidth: 2, borderColor: T.teal + '60' }}>
            <View style={{ alignItems: 'center', marginBottom: 22 }}>
              <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: T.tealGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 2, borderColor: T.teal + '50' }}>
                <MaterialCommunityIcons name="robot-outline" size={30} color={T.teal} />
              </View>
              <Text style={{ fontSize: 13, fontWeight: '900', color: T.teal, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>GEI detectou um produto</Text>
              <Text style={{ fontSize: 22, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 6 }}>{jarvisConfirmModal && jarvisConfirmModal.nome}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: T.amberGlow, borderRadius: 12, borderWidth: 1, borderColor: T.amber + '40' }}>
                <Feather name="calendar" size={14} color={T.amber} />
                <Text style={{ fontSize: 15, fontWeight: '800', color: T.amber }}>Validade: {jarvisConfirmModal && jarvisConfirmModal.validade}</Text>
              </View>
              {jarvisConfirmModal && jarvisConfirmModal.prateleira && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.blueGlow, borderRadius: 12 }}>
                  <Feather name="layers" size={13} color={T.blue} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: T.blue }}>{shlabel(jarvisConfirmModal.prateleira)}</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={jarvisCancelarCadastro} style={{ flex: 1, paddingVertical: 16, borderRadius: 18, backgroundColor: T.bgInput, alignItems: 'center', borderWidth: 1.5, borderColor: T.border }}>
                <Text style={{ color: T.textSub, fontWeight: '900', fontSize: 16 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={jarvisConfirmarCadastro} style={{ flex: 2, paddingVertical: 16, borderRadius: 18, backgroundColor: T.teal, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
                <Feather name="check" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Confirmar cadastro</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {selectedProduct && (<ProductDetailModal visible={!!selectedProduct} product={selectedProduct} onClose={() => setSelectedProduct(null)} onDelete={deleteProduct} onUpdateQuantity={updateProductQuantity} T={T} fontScale={fontScale} fifoMode={fifoMode} allProducts={stockData} />)}
      {/* Not Found Modal */}
      <Modal visible={notFoundModal.visible} transparent animationType="fade" onRequestClose={() => setNotFoundModal({ visible: false, ean: '' })}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setNotFoundModal({ visible: false, ean: '' })} />
          <View style={{ backgroundColor: T.bgCard, borderRadius: 32, padding: 28, borderWidth: 1.5, borderColor: T.border, elevation: 24 }}>
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 80, height: 80, borderRadius: 26, backgroundColor: T.amberGlow, justifyContent: 'center', alignItems: 'center', marginBottom: 18, borderWidth: 2, borderColor: T.amber + '50' }}>
                <Feather name="search" size={36} color={T.amber} />
              </View>
              <Text style={{ fontSize: 21, fontWeight: '900', color: T.text, textAlign: 'center', marginBottom: 8 }}>Produto nao encontrado</Text>
              {notFoundModal.ean ? (<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.bgInput, borderRadius: 12, borderWidth: 1, borderColor: T.border, marginBottom: 8 }}><Feather name="bar-chart-2" size={14} color={T.textSub} /><Text style={{ fontSize: 13, fontWeight: '700', color: T.textSub }}>EAN: {notFoundModal.ean}</Text></View>) : null}
              <Text style={{ fontSize: 14, color: T.textSub, textAlign: 'center', lineHeight: 22, fontWeight: '600', paddingHorizontal: 8 }}>Nao foi possivel identificar este produto nas fontes disponiveis. Cadastre manualmente ou tente escanear novamente.</Text>
            </View>
            <View style={{ gap: 12 }}>
              <TouchableOpacity onPress={() => { setNotFoundModal({ visible: false, ean: '' }); setProdName(''); setWStep(1); navTo('cadastro'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 20, borderRadius: 20, backgroundColor: T.blueGlow, borderWidth: 1.5, borderColor: T.blue + '50' }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: T.blue + '25', justifyContent: 'center', alignItems: 'center' }}><Feather name="edit-3" size={20} color={T.blue} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 15, fontWeight: '900', color: T.blue }}>Cadastrar manualmente</Text><Text style={{ fontSize: 12, color: T.blue + 'AA', fontWeight: '600', marginTop: 2 }}>Digite o nome do produto voce mesmo</Text></View>
                <Feather name="chevron-right" size={18} color={T.blue} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setNotFoundModal({ visible: false, ean: '' }); setScannedEAN(''); handleStartScanning('barcode'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 20, borderRadius: 20, backgroundColor: T.bgInput, borderWidth: 1.5, borderColor: T.border }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: T.bgElevated, justifyContent: 'center', alignItems: 'center' }}><Feather name="camera" size={20} color={T.textSub} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 15, fontWeight: '900', color: T.text }}>Escanear novamente</Text><Text style={{ fontSize: 12, color: T.textSub, fontWeight: '600', marginTop: 2 }}>Tente apontar a camera de outro angulo</Text></View>
                <Feather name="chevron-right" size={18} color={T.textSub} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setNotFoundModal({ visible: false, ean: '' })} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ fontSize: 14, color: T.textSub, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <ProductSourceModal visible={sourceModalVisible} sources={currentSources} onSelect={onSourceSelected} onClose={() => { setSourceModalVisible(false); setCurrentSources([]); setProdName(''); }} T={T} fontScale={fontScale} />
      <Modal visible={shelfModal} transparent animationType="fade" onRequestClose={() => setShelfModal(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShelfModal(false)} /><View style={{ backgroundColor: T.bgCard, borderRadius: 28, padding: 24, borderWidth: 1, borderColor: T.border, elevation: 20 }}><Text style={{ fontSize: 20 * fontScale, fontWeight: '900', color: T.text, marginBottom: 6 }}>Selecionar Prateleira</Text><Text style={{ fontSize: 14 * fontScale, color: T.textSub, marginBottom: 20 }}>Escolha qual setor deseja gerenciar agora.</Text><View style={{ gap: 10 }}>{SHELF_KEYS.map(k => { const on = activeShelf === k; const pal = shelfPalette(T, k); return (<TouchableOpacity key={k} style={[{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 18, backgroundColor: T.bgInput, borderWidth: 2, borderColor: T.border, gap: 14 }, on && { backgroundColor: pal.glow, borderColor: pal.accent }]} onPress={() => switchShelf(k)}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: on ? pal.accent : T.bgElevated, justifyContent: 'center', alignItems: 'center' }}><Feather name={pal.icon} size={18} color={on ? '#FFF' : T.textSub} /></View><Text style={[{ fontSize: 16 * fontScale, fontWeight: '700', color: T.textSub, flex: 1 }, on && { color: pal.accent, fontWeight: '900' }]}>{shlabel(k)}</Text>{on && <Feather name="check-circle" size={20} color={pal.accent} />}</TouchableOpacity>); })}</View><PrimaryBtn label="Fechar" onPress={() => setShelfModal(false)} outline color={T.textSub} style={{ marginTop: 20 }} fontScale={fontScale} /></View></View></Modal>
      {busy && (<View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, alignItems: 'center', justifyContent: 'center' }}><View style={{ backgroundColor: T.bgCard, padding: 30, borderRadius: 24, alignItems: 'center', gap: 20, borderWidth: 1, borderColor: T.border }}><ActivityIndicator size="large" color={T.blue} /><Text style={{ color: T.text, fontWeight: '800', fontSize: 16 }}>{busyMsg || 'Processando...'}</Text></View></View>)}
      <SuccessOverlay visible={showSuccess} onClose={onSuccessDone} T={T} fontScale={fontScale} />
      <NotificationPermissionModal visible={showNotifPermission} onConfirm={handleConfirmNotif} onCancel={() => setShowNotifPermission(false)} T={T} fontScale={fontScale} />
      <ScheduledNotifsModal visible={showScheduledNotifs} onClose={() => setShowScheduledNotifs(false)} T={T} fontScale={fontScale} />
      {cleanToast && !scanning && <AutoCleanToast data={cleanToast} onClose={() => setCleanToast(null)} T={T} fontScale={fontScale} />}
      {erro ? (<View style={{ position: 'absolute', bottom: TAB_SAFE + 16, left: 16, right: 16, zIndex: 9997 }}><ErrBanner msg={erro} onClose={() => setErro('')} /></View>) : null}
      <PinhasCalculatorModal visible={showPinhasModal} onClose={() => setShowPinhasModal(false)} T={T} fontScale={fontScale} />
      <ExpiryAnalysisModal visible={showExpiryModal} onClose={() => setShowExpiryModal(false)} products={stockData} T={T} fontScale={fontScale} />
      {isLogged && !scanning && (
        <AlwaysOnIndicator
          isListening={isAlwaysListening}
          T={T}
          TAB_SAFE={TAB_SAFE}
          onPress={() => { setOpenedByWakeWord(false); setVoiceAssistantVisible(true); }}
          onBellPress={() => setShowScheduledNotifs(true)}
          visible={voiceIndicatorVisible}
          onHide={hideVoiceIndicator}
        />
      )}
      <VoiceAssistant
        visible={voiceAssistantVisible}
        fromWakeWord={openedByWakeWord}
        stockData={stockData}
        scannedEAN={scannedEAN}
        doUpdateExisting={doUpdateExisting}
        onClose={() => { setVoiceAssistantVisible(false); setOpenedByWakeWord(false); }}
        onComplete={handleVoiceComplete}
        T={T}
        fontScale={fontScale}
        userData={userData}
        activeShelf={activeShelf}
        cadastroShelf={cadastroShelf}
        setProdName={setProdName}
        setGiro={setGiro}
        setValidade={setValidade}
        setQtd={setQtd}
        setWStep={setWStep}
        setCadastroShelf={setCadastroShelf}
        setIsVoiceActive={setIsVoiceActive}
      />
      <JarvisCentralModal
        visible={showPainelInteligente}
        onClose={() => { setShowPainelInteligente(false); setJarvisVoiceMode(false); }}
        initialTab={jarvisInitialTab}
        T={T}
        fontScale={fontScale}
        msgs={msgs}
        chatTxt={chatTxt}
        setChatTxt={setChatTxt}
        sendChat={sendChat}
        sendChatVoice={sendChatVoice}
        chatBusy={chatBusy}
        scrollRef={scrollRef}
        TAB_H={TAB_H}
        NAV_BAR_H={NAV_BAR_H}
        setJarvisVoiceMode={setJarvisVoiceMode}
        jarvisVoiceMode={jarvisVoiceMode}
        jarvisRecording={jarvisRecording}
        jarvisProcessing={jarvisProcessing}
        onProgressDone={closeJarvisProgress}
        stockData={stockData}
        userData={userData}
        fifoMode={fifoMode}
      />
      <AppAlertManager ref={ref => { if (ref) AppAlertService._flush(ref); }} T={T} />
      {jarvisVoiceMode && (
        <>
          <_SafeSpeechEventWrapper eventName="start"  onEvent={onJarvisNativeStart} />
          <_SafeSpeechEventWrapper eventName="result" onEvent={onJarvisNativeResult} />
          <_SafeSpeechEventWrapper eventName="end"    onEvent={onJarvisNativeEnd} />
          <_SafeSpeechEventWrapper eventName="error"  onEvent={onJarvisNativeError} />
        </>
      )}
    </View>
  );
}
