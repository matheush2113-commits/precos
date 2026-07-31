/*
=================================================================================
 PREÇO CERTO v6 — versão single-file para Expo Snack (snack.expo.dev)
=================================================================================
 NOVIDADES v6 (melhorias de leitura e precisão):

 1. TAXA DE ATUALIZAÇÃO MAIS FLUIDA (sem travamento visual)
    • Loop de captura: 1150ms → 750ms (modo Legacy/expo-text-extractor)
    • Throttle de casamento ao vivo: 850ms → 600ms (modo Vision Camera)
    • Throttle de caixinhas overlay: 150ms → 100ms (~10fps, mais suave)
    • Cache de frame idêntico já existia; os novos intervalos se beneficiam
      dele — ciclos repetidos com o mesmo rótulo não disparam busca nova.

 2. FILTRO DE REFLEXO EXPANDIDO
    • Mapa dígito→letra agora inclui 3→E e 4→A (fontes de etiqueta térmica
      com brilho/desgaste apagam partes do E e do A).
    • Função reflectionDeglare com tentativa de reconstrução PARCIAL:
      trata palavras com até 2 dígitos "órfãos" no meio de texto alfabético
      mesmo quando algum dígito ainda não tem letra equivalente mapeada.
    • Novo preProcessOcrRaw(): remove artefatos de reflexo já no texto bruto
      (sequências repetidas de caracteres, traços, espaçamentos anômalos)
      antes de qualquer outra etapa do pipeline — aplicado em TODOS os
      modos (frame processor, loop de foto, galeria, foto pontual).

 3. CORREÇÃO OCR MELHORADA
    • OCR_DIGIT_LOOKALIKES (corretor de número perto de ML/KG): agora
      inclui E→3 e A→4 para cobrir mais variações de fonte condensada.
    • PRICE_DIGIT_LOOKALIKES (corretor de preço): idem, E→3 e A→4.
    • VARIANT_KEYWORDS expandida: EXTRA, GOLD, PREMIUM, CLASSIC, ESPECIAL,
      NATURAL, ORGANICO, SEM GLUTEN, VEGANO, SUAVE, FORTE, CONCENTRADO,
      CREME, LIQUIDO, EM PO, SOLAVEL.
    • wordLookalikeTargets extras: ~25 novos termos de rótulo de
      supermercado (ACHOCOLATADO, LEITE, SUCO, ARROZ, FEIJAO, DETERGENTE
      etc.) — o corretor fuzzy agora reconhece erros de 1 letra neles.

 4. DETECÇÃO DE PREÇO MAIS PRECISA
    • Aceita "RS", "R5", "R S", "R $" como variantes OCR de "R$" (câmera
      confunde o cifrão com S ou 5 em tinta pouco contrastante).
    • Aceita separador de milhar: "R$ 1.234,56" é reconhecido corretamente.
    • Prioridade 2 nova: preço perto de palavra-chave (PRECO, VALOR, VLR,
      UNIT) — comum em etiqueta de gôndola com campo de preço rotulado.
    • Tolerância de ruído entre símbolo e número: de 2 para 4 caracteres
      (compensação de reflexo entre o cifrão e o primeiro dígito).
    • Guarda de faixa (0,01 → 99.999): evita aceitar volume/código como
      preço por coincidência.
    • Exclui candidatos que terminam em ML/KG/L/G/UN (ex.: "500ML" não
      vira preço "5,00").

 5. QUALIDADE DE FOTO MELHORADA
    • Captura do loop: quality 0.25 → 0.35 — reduz artefatos de compressão
      JPEG nas bordas das letras, que eram uma causa direta de trocas de
      letra por dígito na OCR.
=================================================================================

COMO USAR:
1. Abra https://snack.expo.dev no navegador (ou app Expo Go > aba "Snacks").
2. Apague todo o conteúdo do arquivo "App.js" que vem por padrão.
3. Cole TODO o conteúdo deste arquivo no lugar.
4. Aguarde alguns segundos: o Snack detecta e instala sozinho os pacotes
   usados nos imports (expo-camera, expo-linear-gradient, etc).
5. Escaneie o QR Code com o app Expo Go (Android/iOS) para rodar no celular
   (a câmera só funciona em dispositivo físico, não no simulador web do Snack).

IMPORTANTE — LEIA ANTES DE USAR:
Esta versão já conversa DE VERDADE com o Baserow (planilha de preços da
Cordeiro Supermercados, tabela 322640) e com a API Cosmos da Bluesoft
(consulta de produto por código de barras), usando os tokens que você
me passou. Não existe mais nenhum banco de dados falso/mock — é a mesma
lógica do backend original (artifacts/api-server), só que rodando direto
no app, sem servidor Node no meio.

⚠️ MODO INTELIGENTE (leitura por imagem) — ISSO NÃO RODA NO EXPO GO:
O Modo Inteligente tira UMA foto da embalagem por vez (usando a câmera do
próprio sistema, via "expo-image-picker" — igual o app de câmera nativo do
celular) e lê o texto nela (OCR 100% no aparelho, via ML Kit no Android /
Apple Vision no iOS, usando a biblioteca "expo-text-extractor" — sem chave,
sem nuvem, sem custo). A versão anterior tentava tirar fotos sozinha em
loop direto da pré-visualização da câmera (CameraView.takePictureAsync),
mas isso se mostrou pouco confiável; o padrão de "abrir a câmera do
sistema, tirar 1 foto, processar" é o mesmo usado no app de exemplo oficial
da biblioteca e é o que realmente funciona. Só que isso é um módulo NATIVO,
e o Expo Go (o app genérico da loja) só roda os módulos que já vêm
pré-instalados nele — não dá pra adicionar um novo módulo nativo dentro do
Expo Go. Então:
  • Rodando pelo Snack/Expo Go: o modo EAN-13 (código de barras) funciona
    normal; o Modo Inteligente vai mostrar um aviso "indisponível aqui".
  • Pra habilitar de verdade o Modo Inteligente, você precisa gerar um
    "Dev Client" (seu próprio app compilado, ainda usando Expo):
      1. npx expo install expo-text-extractor
      2. npx expo prebuild
      3. eas build --profile development --platform android (ou ios)
         (grátis, só precisa de uma conta em expo.dev)
      4. Instala o app gerado no celular e abre o projeto por ele (em vez
         do Expo Go) — dali pra frente funciona como um app normal, com
         atualização ao vivo igual ao Snack.
  • Sem o Dev Client, use o modo EAN-13 (código de barras) normalmente.

⚡ MODO INTELIGENTE "TEMPO REAL" (tipo Google Lens) — INSTALAÇÃO:
Além do Dev Client acima, se você quiser o modo de VERDADE tempo real (câmera
sempre ligada, lendo cada frame, sem tirar foto nenhuma — em vez do "loop de
foto automática" que já funciona), precisa instalar mais 3 pacotes nativos e
reconstruir o app. Passo a passo:
  1. npx expo install react-native-vision-camera react-native-worklets-core
     npm install vision-camera-ocr-plugin
  2. No app.json/app.config.js, adicione o config plugin do vision-camera
     dentro de "plugins":
       ["react-native-vision-camera", {
         "cameraPermissionText": "O Preço Certo usa a câmera pra ler o
           código de barras e o texto da embalagem.",
         "enableCodeScanner": true
       }]
  3. No babel.config.js, adicione o plugin de worklets (TEM que ser o
     ÚLTIMO plugin da lista):
       module.exports = { plugins: [ ['react-native-worklets-core/plugin'] ] };
  4. npx expo prebuild --clean
  5. eas build --profile development --platform android (ou ios)
  6. Instala esse novo app no celular igual ao passo do Dev Client acima.
Se qualquer um desses pacotes não estiver instalado, o app detecta sozinho
(ver bloco "MODO INTELIGENTE — TEMPO REAL" mais abaixo, isVisionCameraSupported)
e volta pro modo de loop de foto — nunca crasha por causa disso.
IMPORTANTE: react-native-vision-camera precisa ser a versão 4.x (NÃO a 5.x) —
a v5 mudou de arquitetura (Nitro Modules) e não é compatível com o plugin de
OCR usado aqui, que ainda depende do sistema antigo de "frame processor".

⚠️ AVISO DE SEGURANÇA — leia antes de compartilhar este Snack:
Como não há mais servidor entre o app e as APIs, os tokens abaixo (bloco
"CONFIGURAÇÃO — TOKENS") ficam GRAVADOS NO CÓDIGO e visíveis para qualquer
pessoa que abrir este Snack ou inspecionar o app (Snacks públicos podem ser
vistos por qualquer um com o link). Quem tiver o token do Baserow consegue
ler/editar/apagar sua planilha de preços inteira, quem tiver o token do
Cosmos consegue gastar suas consultas, e quem tiver a chave da Groq consegue
gastar seu limite de uso de IA. Recomendações:
  • Deixe este Snack como PRIVADO (não publique o link).
  • Se algum dia isso vazar, revogue e gere tokens/chaves novos no Baserow,
    na Bluesoft e no console da Groq (console.groq.com) imediatamente.
  • Se quiser, no futuro, colocar isso em produção com segurança, o certo é
    voltar a usar um servidor (como o artifacts/api-server original) que
    guarda os tokens no back-end e nunca os expõe no app.

Ignorei imagens/assets do projeto original (ícone, splash), como pedido.
=================================================================================
*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
// OCR 100% no aparelho (ML Kit no Android / Apple Vision no iOS), sem chave,
// sem internet, sem custo por consulta.
//
// ATENÇÃO — isso é um módulo NATIVO. Dentro do Expo Go (ou do simulador web
// do Snack) o código nativo do ML Kit/Apple Vision não existe, e carregar
// esse módulo lança um erro. Um `import` normal do JS roda ANTES de
// qualquer try/catch do seu código, então um import estático aqui derruba
// o app inteiro assim que o Expo Go tenta abrir o arquivo — foi exatamente
// o erro "Cannot find native module 'ExpoTextExtractor'" que você viu.
// Por isso o carregamento é feito com require() DENTRO de um try/catch:
// assim, se o módulo nativo não existir, a gente simplesmente desativa o
// Modo Inteligente (isSmartModeSupported = false) em vez de crashar.
let extractTextFromImage = null;
let isTextExtractorSupported = false;
try {
  // eslint-disable-next-line global-require
  const textExtractorModule = require('expo-text-extractor');
  extractTextFromImage = textExtractorModule.extractTextFromImage;
  isTextExtractorSupported = !!textExtractorModule.isSupported;
} catch (e) {
  extractTextFromImage = null;
  isTextExtractorSupported = false;
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE "TEMPO REAL" (tipo Google Lens) — OPCIONAL              */
/*                                                                            */
/* Isso usa react-native-vision-camera + um frame processor de OCR, que lê   */
/* texto de CADA FRAME da câmera ao vivo (ML Kit / Vision Framework rodando  */
/* direto na thread da câmera) — sem tirar foto nenhuma, de verdade tempo    */
/* real. É um passo bem maior que o expo-text-extractor acima: precisa de    */
/* módulo nativo + plugin de frame processor + worklets, e SÓ funciona num   */
/* app compilado com esses pacotes instalados (não roda no Expo Go nem no    */
/* Snack — nem mesmo no Dev Client que você já tem hoje, se ele ainda não    */
/* tiver essas libs. Ver INSTALAÇÃO — MODO TEMPO REAL logo no topo do        */
/* arquivo). Por isso o carregamento é 100% guardado por try/catch, igual ao */
/* expo-text-extractor: se não estiver instalado, `isVisionCameraSupported`  */
/* fica `false` e o app cai de volta pro modo Inteligente "de loop" que já   */
/* tínhamos (ScannerScreenLegacy, sem mudar nada nele) — nunca crasha.       */
let VisionCamera = null;
let scanOCR = null;
let Worklets = null;
let isVisionCameraSupported = false;
try {
  // eslint-disable-next-line global-require
  VisionCamera = require('react-native-vision-camera');
  // eslint-disable-next-line global-require
  const ocrPluginModule = require('vision-camera-ocr-plugin');
  scanOCR = ocrPluginModule.scanOCR;
  // eslint-disable-next-line global-require
  const workletsModule = require('react-native-worklets-core');
  Worklets = workletsModule.Worklets;
  isVisionCameraSupported = !!(VisionCamera && VisionCamera.Camera && typeof scanOCR === 'function' && Worklets);
} catch (e) {
  VisionCamera = null;
  scanOCR = null;
  Worklets = null;
  isVisionCameraSupported = false;
}

// Hooks do vision-camera só existem se o módulo carregou. Quando não carrega,
// usamos versões "vazias" com a MESMA assinatura — assim dá pra chamar os
// hooks sempre na mesma ordem (regra dos hooks do React) sem precisar de
// `if` em volta deles lá no componente.
const VCCamera = isVisionCameraSupported ? VisionCamera.Camera : null;
const useVCCameraDevice = isVisionCameraSupported ? VisionCamera.useCameraDevice : () => null;
const useVCCameraPermission = isVisionCameraSupported
  ? VisionCamera.useCameraPermission
  : () => ({ hasPermission: false, requestPermission: async () => false });
const useVCFrameProcessor = isVisionCameraSupported ? VisionCamera.useFrameProcessor : () => undefined;
const useVCCodeScanner = isVisionCameraSupported ? VisionCamera.useCodeScanner : () => undefined;

SplashScreen.preventAutoHideAsync().catch(() => {});

/* ------------------------------------------------------------------------ */
/* DESIGN TOKENS (cores do app original)                                    */
/* ------------------------------------------------------------------------ */

const colors = {
  text: '#0f1b33',
  tint: '#1b4fd8',
  background: '#f3f6fc',
  foreground: '#0f1b33',
  card: '#ffffff',
  cardForeground: '#0f1b33',
  primary: '#1b4fd8',
  primaryForeground: '#ffffff',
  secondary: '#eaf0ff',
  secondaryForeground: '#1b4fd8',
  muted: '#edf1f7',
  mutedForeground: '#6b7690',
  accent: '#ffc229',
  accentForeground: '#2b1d00',
  destructive: '#e5484d',
  destructiveForeground: '#ffffff',
  border: '#e2e7f0',
  input: '#e2e7f0',
  success: '#1f9d55',
  successForeground: '#ffffff',
};

/* ------------------------------------------------------------------------ */
/* HELPERS DE FORMATAÇÃO                                                     */
/* ------------------------------------------------------------------------ */

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(value) {
  if (value === null || value === undefined) return currencyFormatter.format(0);
  return currencyFormatter.format(value);
}

function centsToAmount(digits) {
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

function formatCentsBuffer(digits) {
  const normalized = digits === '' ? '0' : digits;
  return formatBRL(centsToAmount(normalized));
}

/**
 * Formata o valor de volume para exibição na interface.
 *
 * REGRA DE CONVERSÃO — a coluna ML no Baserow guarda o volume em litros
 * quando o valor é menor que 100 (ex.: 1 = 1L, 0.5 = 500ML, 1.5 = 1500ML).
 * Quando o valor é >= 100, entende-se que está em ml (ex.: 250 = 250ML,
 * 1000 = 1000ML = 1L).
 */
function formatVolume(volume) {
  if (volume === null || volume === undefined) return '';

  // Se o valor está na faixa de litros (1, 1.5, 2, etc.), exibe como litros.
  // Produtos de leite, água, suco, etc. são gravados como litros no Baserow.
  if (volume > 0 && volume < 100) {
    const label = Number.isInteger(volume) ? String(volume) : volume.toFixed(1).replace('.', ',');
    return `${label}L`;
  }

  // Se o valor está na faixa de ml (>= 100), converte para litros se >= 1000.
  if (volume >= 1000) {
    const liters = volume / 1000;
    const label = Number.isInteger(liters) ? String(liters) : liters.toFixed(1).replace('.', ',');
    return `${label}L`;
  }

  // Valor em ml (100 <= volume < 1000).
  return `${Math.round(volume)}ML`;
}

/* ------------------------------------------------------------------------ */
/* ÍCONES (SVG, sem dependência de fonte de ícones)                          */
/* ------------------------------------------------------------------------ */

const commonProps = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

function renderGlyph(name, color) {
  const p = { ...commonProps, stroke: color };
  switch (name) {
    case 'alert-circle':
      return (
        <>
          <Circle cx={12} cy={12} r={10} {...p} />
          <Line x1={12} y1={8} x2={12} y2={12} {...p} />
          <Line x1={12} y1={16} x2={12.01} y2={16} {...p} />
        </>
      );
    case 'camera':
      return (
        <>
          <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p} />
          <Circle cx={12} cy={13} r={4} {...p} />
        </>
      );
    case 'check':
      return <Polyline points="20 6 9 17 4 12" {...p} />;
    case 'check-circle':
      return (
        <>
          <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" {...p} />
          <Polyline points="22 4 12 14.01 9 11.01" {...p} />
        </>
      );
    case 'chevron-right':
      return <Polyline points="9 18 15 12 9 6" {...p} />;
    case 'delete':
      return (
        <>
          <Path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" {...p} />
          <Line x1={18} y1={9} x2={12} y2={15} {...p} />
          <Line x1={12} y1={9} x2={18} y2={15} {...p} />
        </>
      );
    case 'droplet':
      return <Path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" {...p} />;
    case 'edit-2':
      return <Path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" {...p} />;
    case 'edit-3':
      return (
        <>
          <Path d="M12 20h9" {...p} />
          <Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" {...p} />
        </>
      );
    case 'hash':
      return (
        <>
          <Line x1={4} y1={9} x2={20} y2={9} {...p} />
          <Line x1={4} y1={15} x2={20} y2={15} {...p} />
          <Line x1={10} y1={3} x2={8} y2={21} {...p} />
          <Line x1={16} y1={3} x2={14} y2={21} {...p} />
        </>
      );
    case 'inbox':
      return (
        <>
          <Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" {...p} />
          <Path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...p} />
        </>
      );
    case 'list':
      return (
        <>
          <Line x1={8} y1={6} x2={21} y2={6} {...p} />
          <Line x1={8} y1={12} x2={21} y2={12} {...p} />
          <Line x1={8} y1={18} x2={21} y2={18} {...p} />
          <Line x1={3} y1={6} x2={3.01} y2={6} {...p} />
          <Line x1={3} y1={12} x2={3.01} y2={12} {...p} />
          <Line x1={3} y1={18} x2={3.01} y2={18} {...p} />
        </>
      );
    case 'package':
      return (
        <>
          <Line x1={16.5} y1={9.4} x2={7.5} y2={4.21} {...p} />
          <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" {...p} />
          <Polyline points="3.27 6.96 12 12.01 20.73 6.96" {...p} />
          <Line x1={12} y1={22.08} x2={12} y2={12} {...p} />
        </>
      );
    case 'rotate-ccw':
      return (
        <>
          <Polyline points="1 4 1 10 7 10" {...p} />
          <Path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" {...p} />
        </>
      );
    case 'send':
      return (
        <>
          <Line x1={22} y1={2} x2={11} y2={13} {...p} />
          <Polygon points="22 2 15 22 11 13 2 9 22 2" {...p} />
        </>
      );
    case 'tag':
      return (
        <>
          <Path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" {...p} />
          <Line x1={7} y1={7} x2={7.01} y2={7} {...p} />
        </>
      );
    case 'image':
      return (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={2} ry={2} {...p} />
          <Circle cx={8.5} cy={8.5} r={1.5} {...p} />
          <Polyline points="21 15 16 10 5 21" {...p} />
        </>
      );
    case 'trash-2':
      return (
        <>
          <Polyline points="3 6 5 6 21 6" {...p} />
          <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...p} />
          <Line x1={10} y1={11} x2={10} y2={17} {...p} />
          <Line x1={14} y1={11} x2={14} y2={17} {...p} />
        </>
      );
    case 'wifi-off':
      return (
        <>
          <Line x1={1} y1={1} x2={23} y2={23} {...p} />
          <Path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" {...p} />
          <Path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" {...p} />
          <Path d="M10.71 5.05A16 16 0 0 1 22.58 9" {...p} />
          <Path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" {...p} />
          <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" {...p} />
          <Line x1={12} y1={20} x2={12.01} y2={20} {...p} />
        </>
      );
    case 'zap':
      return <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" {...p} />;
    case 'x':
      return (
        <>
          <Line x1={18} y1={6} x2={6} y2={18} {...p} />
          <Line x1={6} y1={6} x2={18} y2={18} {...p} />
        </>
      );
    default:
      return null;
  }
}

function Icon({ name, size = 20, color = '#000000' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderGlyph(name, color)}
    </Svg>
  );
}

/* ------------------------------------------------------------------------ */
/* CONFIGURAÇÃO — TOKENS (Baserow + Bluesoft Cosmos)                         */
/* ------------------------------------------------------------------------ */
// Veja o AVISO DE SEGURANÇA no topo do arquivo antes de compartilhar este
// Snack com alguém ou publicá-lo. Para trocar os tokens no futuro, edite
// só as duas linhas abaixo.

const BASEROW_API_TOKEN = 'Zpp1pMg1AYeG0lnXC1De0hIZID19BUM6';
const COSMOS_API_TOKEN = 'M3aC1LJBRBGtMuQMvXY2tA';
const GROQ_API_KEY = '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';
// Chave do SerpApi (serpapi.com) — usada só como REFORÇO do Modo Inteligente
// quando o casamento direto (regras + fuzzy) não acha nada de confiança: a
// gente pesquisa o texto lido no Google de verdade e confere o que aparece.
// Se essa chave ficar inválida ou estourar o limite de buscas, a função
// correspondente simplesmente devolve null e o app segue funcionando com as
// outras camadas (fuzzy, IA, sílaba) — nunca trava por causa disso.
const SERPAPI_API_KEY = '8c215e3fa31b06c116f4e269dcc2f3cf19d777af7a764398ee0060f076c7798b';

// Planilha "Cordeiro Supermercados" no Baserow: database 123771 / tabela 322640
const BASEROW_TABLE_ID = '322640';
const BASEROW_BASE_URL = `https://api.baserow.io/api/database/rows/table/${BASEROW_TABLE_ID}`;

/* ------------------------------------------------------------------------ */
/* BANCO DE DADOS LOCAL (snapshot do CSV exportado)                          */
/*                                                                           */
/* Cópia local dos produtos mais comuns da tabela Baserow 322640. Serve como */
/* CACHE FRIO: quando o app está sem internet ou o Baserow demora, essa base  */
/* garante que o OCR já encontra os produtos principais instantaneamente,    */
/* sem latência de rede. O Baserow ainda é a fonte de verdade — esta lista   */
/* só funciona como acelerador / fallback offline.                           */
/* Quando a planilha crescer, basta re-exportar o CSV e atualizar esta lista.*/
/* ------------------------------------------------------------------------ */
const LOCAL_PRODUCTS_SNAPSHOT = [
  { id: 3,   codigo: '0000789366830', produto: 'CERV LAGER HEINEKEN LN 6X330ml',          ml: 330, quantidade: 6  },
  { id: 4,   codigo: '7891991015462', produto: 'CERV STELLA ARTOIS LN 6X330ml',           ml: 330, quantidade: 6  },
  { id: 5,   codigo: '7891149108732', produto: 'CERV LAGER CORONA LN 6X330ml',            ml: 330, quantidade: 6  },
  { id: 6,   codigo: '7891991014762', produto: 'CERV LAGER BUDWEISER LN 6X330ml',         ml: 330, quantidade: 6  },
  { id: 7,   codigo: '7896045506040', produto: 'CERV HEINEKEN ZERO ALC LN 6X330ml',       ml: 330, quantidade: 6  },
  { id: 8,   codigo: '7891991297493', produto: 'CERV  P MALTE SPATEM LN 6X355ml',         ml: 355, quantidade: 6  },
  { id: 9,   codigo: '7891149104932', produto: 'CERV BRAHMA ZERO ÁLCOOL 12X350ml',        ml: 350, quantidade: 12 },
  { id: 10,  codigo: '7896045506064', produto: 'CERV HEINEKEN ZERO ÁLCOOL 12X350ml',      ml: 350, quantidade: 12 },
  { id: 11,  codigo: '7898367983356', produto: 'CERV EISENBAHN 12X473ml',                 ml: 473, quantidade: 12 },
  { id: 12,  codigo: '7896045505340', produto: 'CERVEJA LAGER AMSTEL 12X473ml',           ml: 473, quantidade: 12 },
  { id: 13,  codigo: '7896045506248', produto: 'CERV HEINEKEN LT 12X473ml',               ml: 473, quantidade: 12 },
  { id: 14,  codigo: '7896045503414', produto: 'CERVEJA PILSEN KAISER 12X473ml',          ml: 473, quantidade: 12 },
  { id: 15,  codigo: '7891991009164', produto: 'CERV PILSEN ANTARTICA 12X473ml',          ml: 473, quantidade: 12 },
  { id: 16,  codigo: '7891991295017', produto: 'CERV ANTARCTICA ORIGINAL 12X473ml',       ml: 473, quantidade: 12 },
  { id: 17,  codigo: '7891149011001', produto: 'CERVEJA BRAHMA  12X473ml',                ml: 473, quantidade: 12 },
  { id: 18,  codigo: '7891991303309', produto: 'CERVEJA STELLA ARTOIS 12X473ml',          ml: 473, quantidade: 12 },
  { id: 19,  codigo: '7891991014236', produto: 'CERVEJA P MALTE BOHEMIA 473ml',           ml: 473, quantidade: 12 },
  { id: 20,  codigo: '7891991303200', produto: 'CERVE P MALTE SPATEM LT  12X473ml',       ml: 473, quantidade: 12 },
  { id: 21,  codigo: '07891991010153',produto: 'CERV ANTARTICA SUB ZERO 473ml',           ml: 473, quantidade: 12 },
  { id: 22,  codigo: '7896051111016', produto: 'LEITE ITAMBÊ INTEGRAL 12X1L',             ml: 1,   quantidade: 12 },
  { id: 23,  codigo: '7896051111702', produto: 'LEITE ITAMBÊ DESNATADO 12X1L',            ml: 1,   quantidade: 12 },
  { id: 24,  codigo: '7896051111528', produto: 'LEITE ITAMBÊ SEMIDESNATADO 12X1L',        ml: 1,   quantidade: 12 },
  { id: 25,  codigo: '7896122305207', produto: 'LEITE PORTO ALEGRE INTEGRAL 12X1L',       ml: 1,   quantidade: 12 },
  { id: 26,  codigo: '7896183202187', produto: 'LEITE QUATA INTEGRAL 12X1L',              ml: 1,   quantidade: 12 },
  { id: 27,  codigo: '7898215151708', produto: 'LEITE PIRACANJUBA INTEGRAL 12X1L',        ml: 1,   quantidade: 12 },
  { id: 28,  codigo: '7896447500103', produto: 'ÁGUA IGARAPE SEM GÁS 12X500ml',           ml: 500, quantidade: 12 },
  { id: 29,  codigo: '7896447500363', produto: 'ÁGUA IGARAPÉ COM GÁS 12X500ml',           ml: 500, quantidade: 12 },
  { id: 30,  codigo: '000789338738',  produto: 'REFRI COCA COLA MINI PET 12X200ml',       ml: 200, quantidade: 12 },
  { id: 31,  codigo: '7800660636419', produto: 'REFRI SUKITA LARANJA PET 12X200ml',       ml: 200, quantidade: 12 },
  { id: 32,  codigo: '07891991014984',produto: 'REFRI SODA LIMONADA PET 12X200ml',        ml: 200, quantidade: 12 },
  { id: 33,  codigo: '7891991014908', produto: 'REFRI GUARANÁ ANTARTICA PET 12X200ml',    ml: 200, quantidade: 12 },
  { id: 34,  codigo: '7891991016124', produto: 'REFRI GUARANÁ ZERO PET 12X200ml',         ml: 200, quantidade: 12 },
  { id: 35,  codigo: '7892840800567', produto: 'REFRI PEPSI PET 12X200ml',                ml: 200, quantidade: 12 },
  { id: 36,  codigo: '7896036090855', produto: 'ÓLEO DE SOJA VELEIRO 6X900ml',            ml: 900, quantidade: 6  },
  { id: 37,  codigo: '7896036090244', produto: 'ÓLEO DE SOJA LIZA 6X900ml',               ml: 900, quantidade: 6  },
  { id: 38,  codigo: '7891149040308', produto: 'CERV MALZBIER BRAHMA 6X355ml',            ml: 355, quantidade: 6  },
  { id: 39,  codigo: '7898915949193', produto: 'CERV PILSEN IMPERIO 12X473ml',            ml: 473, quantidade: 12 },
  { id: 40,  codigo: '7891991011723', produto: 'CERV PILSEN BUDWEISER 12X473ml',          ml: 473, quantidade: 12 },
  { id: 67,  codigo: '7896427701391', produto: 'LEITE INTEGRAL ITA 12X1L',                ml: 1,   quantidade: 12 },
  { id: 68,  codigo: '7898080640017', produto: 'LEITE  INTEGRAL ITALAC 12X1L',            ml: 1,   quantidade: 12 },
  { id: 69,  codigo: '7898926669042', produto: 'AGUA MIN GRAO MOGOL 12X500ml',            ml: 500, quantidade: 12 },
  { id: 70,  codigo: '7891991297479', produto: 'CERV P MALTE SPATEM LN 6X355ml',         ml: 355, quantidade: 6  },
  { id: 71,  codigo: '7896045505371', produto: 'CERV LAGER HEINEKEN LN 6X330ml',          ml: 330, quantidade: 6  },
  { id: 72,  codigo: '7898969406963', produto: 'CERV PILSEN BRUDER BX GASTRO 12X473ml',   ml: 473, quantidade: 12 },
  { id: 73,  codigo: '789862528372',  produto: 'CERV PILSEN LAUT 12X473ml',               ml: 473, quantidade: 12 },
  { id: 74,  codigo: '7897395099695', produto: 'CERV P MALTE PETRA 12X473ml',             ml: 473, quantidade: 12 },
  { id: 75,  codigo: '7897395020217', produto: 'CERV PILSEN ITAIPAVA LT 12X473ml',        ml: 473, quantidade: 12 },
  { id: 76,  codigo: '7891149201006', produto: 'CERV PILSEN SKOL LT 12X473ml',            ml: 473, quantidade: 12 },
  { id: 100, codigo: '7891991303484', produto: 'CERV LAGER CORONA LN 6X330ml',            ml: 330, quantidade: 6  },
  { id: 133, codigo: '7891991014779', produto: 'CERV LAGER BUDWEISER LN 6X330ml',         ml: 330, quantidade: 6  },
  { id: 167, codigo: '7898962528372', produto: 'CERV PILSEN LAUT 12X473ml',               ml: 473, quantidade: 12 },
  { id: 199, codigo: '7891991014984', produto: 'REFRI CAÇULINHA  SODA 12X200ml',          ml: 200, quantidade: 12 },
  { id: 232, codigo: '000789366830',  produto: 'CERV LAGER HEINEKEN LN 6X330ml',          ml: 330, quantidade: 6  },
  { id: 233, codigo: '78936683',      produto: 'CERV LAGER HEINEKEN LN 6X330ml',          ml: 330, quantidade: 6  },
  { id: 265, codigo: '7896045503063', produto: 'CERVEJA KAISER 12X473ml',                 ml: 473, quantidade: 12 },
  { id: 266, codigo: '7891149210503', produto: 'CERV MALZIBIER CARACU 12X350ml',          ml: 350, quantidade: 12 },
  { id: 298, codigo: '7896590801232', produto: 'LEITE INTEGRAL CEMIL  12X1L',             ml: 1,   quantidade: 12 },
  { id: 331, codigo: '7891991298421', produto: 'CERV ZERO ALC BUDWEISER LN 6x330ml',      ml: 330, quantidade: 6  },
  { id: 364, codigo: '7898367983813', produto: 'CERV AMERICA IPA EISENBAHN LN 6X355ml',   ml: 355, quantidade: 6  },
  { id: 365, codigo: '7898367980034', produto: 'CERV PALE ALE  EISENBAHN LN 6X355ml',     ml: 355, quantidade: 6  },
  { id: 366, codigo: '7891149010301', produto: 'CERV PILSEN BRAHMA LN 6X355ml',           ml: 355, quantidade: 6  },
  { id: 367, codigo: '7895045506439', produto: 'CERV UTRA AMSTEL LN 6X275ml',             ml: 275, quantidade: 6  },
  { id: 368, codigo: '7894900151510', produto: 'FANTA LARANJA ZERO 12x2l',                ml: 2,   quantidade: 12 },
  { id: 397, codigo: '7896547501178', produto: 'COQ COROTE LIMAO 12X500ml',               ml: 500, quantidade: 12 },
  { id: 430, codigo: '7896657764128', produto: 'CERV CHOPP ESCOBIR 12X473ml',             ml: 473, quantidade: 12 },
  { id: 463, codigo: '000789089012',  produto: 'REFRI COCA COLA MINI PET 12X200ml',       ml: 200, quantidade: 12 },
  { id: 496, codigo: '7891991012454', produto: 'CERV PILSEN BUDWEISER 12X473ml',          ml: 473, quantidade: 12 },
  { id: 497, codigo: '7891149108282', produto: 'REFRI SUKITA LARANJA PET 12X200ml',       ml: 200, quantidade: 12 },
  { id: 498, codigo: '7896447500462', produto: 'ÁGUA IGARAPE SEM GÁS 12X500ml',           ml: 500, quantidade: 12 },
  { id: 529, codigo: '7891149108718', produto: 'CERV LAGER CORONA LN 6X330ml',            ml: 330, quantidade: 6  },
  { id: 530, codigo: '3228982014762', produto: 'CERV LAGER BUDWEISER LN 6X330ml',         ml: 330, quantidade: 6  },
  { id: 562, codigo: '7896045506910', produto: 'CERV HEINEKEN ZERO ÁLCOOL 12X350ml',      ml: 350, quantidade: 12 },
  { id: 563, codigo: '000001066418',  produto: 'REFRI COCA COLA 12X350ML',                ml: 350, quantidade: 12 },
  { id: 595, codigo: '7898080640611', produto: 'LEITE INTEGRAL ITALAC 12X1L',             ml: 1,   quantidade: 12 },
  { id: 628, codigo: '7898080640628', produto: 'LEITE ED SEMI DESN ITALAC 12X1L',         ml: 1,   quantidade: 12 },
  { id: 661, codigo: '7896434920549', produto: 'LEITE INTEGRAL TRIANGULO 12X1L',          ml: 1,   quantidade: 12 },
  { id: 664, codigo: '7896434920631', produto: 'LEITE  TRIANGULO DESNATADO 1L 1000MLX12', ml: 1000,quantidade: 12 },
  { id: 666, codigo: '7896569405027', produto: 'LEITE DESNATADO LIDER 1LX12',             ml: 1,   quantidade: 12 },
  { id: 668, codigo: '378832203211',  produto: 'COCA COLA 12X200ML',                      ml: 200, quantidade: 6  },
  { id: 669, codigo: '7896045506439', produto: 'CERVEJA AMSTEL PURO MALTE GARRAFA 6x275ml',ml: 275,quantidade: 6 },
  { id: 670, codigo: '7898962528532', produto: 'LAUT 355ML DE LEVE',                      ml: 355, quantidade: 6  },
  { id: 671, codigo: '7896051128069', produto: 'LEITE ZERO LACTOSE ITAMBE 1LX12',         ml: 1,   quantidade: 12 },
  { id: 672, codigo: '7896045507696', produto: 'CERV HEINEKEN ULTIMATE S/GLUTEN 6x330ML LN',ml: 330,quantidade: 6},
  { id: 673, codigo: '0000078933873', produto: 'COCA COLA ZERO PET 12X200ML',             ml: 200, quantidade: 12 },
];
const FIELD_IDS = {
  codigo: 2349768,
  produto: 2349769,
  preco: 2349771,
  ml: 2349772,
  quantidade: 2349773,
};

/* ------------------------------------------------------------------------ */
/* INTEGRAÇÃO REAL COM BASEROW                                               */
/* ------------------------------------------------------------------------ */

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToProduct(row) {
  return {
    id: row.id,
    codigo: row.CODIGO ?? '',
    produto: row.PRODUTO ?? '',
    preco: toNumberOrNull(row['PREÇO']),
    ml: toNumberOrNull(row.ML),
    quantidade: toNumberOrNull(row.QUANTIDADE),
  };
}

// FATOR EXTRA DE CONFIABILIDADE — timeout em TODA chamada ao Baserow.
//
// Bug relatado: a busca "fica em loading" e não busca produto rápido. Causa
// raiz: o `fetch` puro do JavaScript NÃO tem timeout nenhum por padrão — se
// a rede engasgar (wifi fraco de loja, sinal caindo, servidor lento pra
// responder mas sem fechar a conexão), a Promise do fetch fica pendurada
// PRA SEMPRE, nunca resolve nem rejeita. Isso significa que o try/catch em
// volta (em listAllProductsCached, findProductByCodigo etc.) NUNCA disparava
// — o catch só protege contra erro, não contra "nunca responder". Resultado
// na prática: a tela trava em "carregando" indefinidamente, e nenhuma das
// outras camadas de reconhecimento (direto, sílaba, letras em comum...)
// consegue rodar, porque todas dependem de listAllProductsCached esperando
// essa mesma chamada travada.
//
// Correção: AbortController com prazo — mesma técnica já usada na chamada
// do SerpApi (ver SERPAPI_TIMEOUT_MS mais abaixo). Depois desse prazo, o
// fetch é cancelado à força e vira um erro de verdade, que os try/catch já
// existentes sabem tratar (cai pro snapshot local, ou deixa a próxima
// camada de reconhecimento assumir).
const BASEROW_TIMEOUT_MS = 8000;

async function baserowFetch(path, init) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BASEROW_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASEROW_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${BASEROW_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Busca uma linha pelo CODIGO (código de barras) exato. */
async function findProductByCodigo(codigo) {
  if (!codigo) return null;

  // 1) Tenta no snapshot local primeiro (instantâneo, sem rede).
  const codigoNorm = String(codigo).replace(/\D/g, ''); // só dígitos
  const local = LOCAL_PRODUCTS_SNAPSHOT.find((p) => {
    const pNorm = String(p.codigo).replace(/\D/g, '');
    return pNorm === codigoNorm || p.codigo === codigo;
  });
  if (local) return local;

  // 2) Se o cache do Baserow já tiver dados frescos, busca lá também
  //    (pode ter produtos novos que ainda não estão no snapshot).
  if (productsCache && !productsCache.fromSnapshot) {
    const cached = productsCache.rows.find((p) => {
      const pNorm = String(p.codigo ?? '').replace(/\D/g, '');
      return pNorm === codigoNorm || p.codigo === codigo;
    });
    if (cached) return cached;
  }

  // 3) Consulta o Baserow diretamente (com fallback silencioso).
  try {
    const params = new URLSearchParams({
      user_field_names: 'true',
      size: '1',
      [`filter__field_${FIELD_IDS.codigo}__equal`]: codigo,
    });
    const res = await baserowFetch(`/?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Baserow lookup falhou (status ${res.status}) ${body}`);
    }
    const data = await res.json();
    const row = data.results[0];
    return row ? rowToProduct(row) : null;
  } catch (err) {
    // Sem internet — já tentamos o local acima, então retorna null
    return null;
  }
}

/** Busca todas as linhas da tabela, seguindo a paginação. */
async function listAllProductsRaw() {
  const rows = [];
  let url = `/?${new URLSearchParams({ user_field_names: 'true', size: '200' }).toString()}`;
  // Trava de segurança: nunca deveria passar de umas poucas centenas de
  // páginas (200 produtos por página) — se acontecer, é sinal de paginação
  // quebrada/em loop, e é melhor parar com o que já tem do que girar pra
  // sempre travando a tela.
  let safetyPages = 0;
  const MAX_PAGES = 200;
  while (url && safetyPages < MAX_PAGES) {
    safetyPages += 1;
    const res = await baserowFetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Baserow list falhou (status ${res.status}) ${body}`);
    }
    const data = await res.json();
    rows.push(...data.results);
    if (data.next) {
      const nextUrl = new URL(data.next);
      url = `/?${nextUrl.searchParams.toString()}`;
    } else {
      url = null;
    }
  }
  return rows.map(rowToProduct);
}

async function createProductRow(fields) {
  const params = new URLSearchParams({ user_field_names: 'true' });
  const res = await baserowFetch(`/?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      CODIGO: fields.codigo,
      PRODUTO: fields.produto,
      ['PREÇO']: fields.preco ?? null,
      ML: fields.ml ?? null,
      QUANTIDADE: fields.quantidade ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Baserow create falhou (status ${res.status}) ${body}`);
  }
  const row = await res.json();
  return rowToProduct(row);
}

async function updateProductRowRemote(id, fields) {
  const params = new URLSearchParams({ user_field_names: 'true' });
  const body = {};
  if (fields.produto !== undefined) body['PRODUTO'] = fields.produto;
  if (fields.preco !== undefined) body['PREÇO'] = fields.preco;
  if (fields.ml !== undefined) body['ML'] = fields.ml;
  if (fields.quantidade !== undefined) body['QUANTIDADE'] = fields.quantidade;

  const res = await baserowFetch(`/${id}/?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new Error(`Baserow update falhou (status ${res.status}) ${responseBody}`);
  }
  const row = await res.json();
  return rowToProduct(row);
}

/** Apaga a linha inteira (produto) do Baserow pelo id. */
async function deleteProductRowRemote(id) {
  const res = await baserowFetch(`/${id}/`, { method: 'DELETE' });
  if (res.status === 404) return true; // já não existe — considera excluído
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Baserow delete falhou (status ${res.status}) ${body}`);
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* INTEGRAÇÃO REAL COM COSMOS (BLUESOFT)                                     */
/* ------------------------------------------------------------------------ */

// Mesmo problema do Baserow (ver BASEROW_TIMEOUT_MS, mais acima): fetch sem
// timeout pode ficar pendurado pra sempre se a rede engasgar — e como é
// chamado direto do useEffect da tela de confirmação (ver lookupProduct),
// isso deixava a tela travada em "carregando" indefinidamente pra qualquer
// código de barras novo (que precisa consultar o Cosmos, não achado ainda
// no Baserow). Mesma correção: AbortController com prazo.
const COSMOS_TIMEOUT_MS = 8000;

/** Consulta um produto pelo GTIN/código de barras no catálogo Cosmos. */
async function lookupCosmosProduct(gtin) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COSMOS_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Cosmos-API-Request',
        'Content-Type': 'application/json',
        'X-Cosmos-Token': COSMOS_API_TOKEN,
      },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) return null; // sem estoque na Cosmos, chave inválida, limite etc. — segue o fluxo como "não achado", não trava a tela
    return await res.json();
  } catch {
    // timeout, sem internet, resposta malformada etc. — mesma ideia: não
    // acha nada, mas NUNCA deixa a Promise pendurada nem propaga erro pra
    // travar a tela de confirmação.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------------ */
/* REGRAS DE NOMEAÇÃO/EMBALAGEM (mesma lógica do backend original)           */
/* ------------------------------------------------------------------------ */

function extractMl(descriptionUpper) {
  const mlMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*ML\b/i);
  if (mlMatch) return Math.round(parseFloat(mlMatch[1].replace(',', '.')));
  const literMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*L\b/i);
  if (literMatch) return Math.round(parseFloat(literMatch[1].replace(',', '.')) * 1000);
  return null;
}

/**
 * Igual ao extractMl, mas para PESO (G/KG) — sinal que faltava: produtos
 * vendidos por peso (arroz, café, carne, farinha...) não tinham nenhum
 * número "matador" pra confirmar/descartar candidato, só o ML/L, que não
 * aparece nesse tipo de produto. Sempre devolve o valor em GRAMAS (KG vira
 * ×1000) pra poder comparar direto com o extraído do outro texto.
 */
function extractWeightGrams(descriptionUpper) {
  const kgMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*KG\b/i);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1].replace(',', '.')) * 1000);
  const gMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*G\b/i);
  if (gMatch) return Math.round(parseFloat(gMatch[1].replace(',', '.')));
  return null;
}

function isMilkDescription(descriptionUpper) {
  return /\bLEITE\b/.test(descriptionUpper);
}

/**
 * Calcula o preço por LITRO a partir do preço da embalagem e do volume em
 * ml — útil pra comparar produtos de tamanhos diferentes (ex.: qual rende
 * mais, a garrafa de 200ml ou a de 2L). Devolve null se faltar preço ou ml,
 * ou se o ml for 0 (evita dividir por zero).
 */
function computeUnitPricePerLiter(preco, ml) {
  if (preco === null || preco === undefined || !ml) return null;
  const litros = ml / 1000;
  if (litros <= 0) return null;
  return preco / litros;
}

/**
 * Acha a quantidade de fardo/caixa num texto livre (OCR ou nome cadastrado):
 * "12X", "X12", "12 X", "CAIXA COM 12", "CX 12", "C/12". Devolve null se não
 * achar nenhum padrão — nesse caso productTextSimilarity simplesmente ignora
 * esse sinal (não penaliza nem bonifica).
 */
/**
 * Acha um PREÇO no texto lido (OCR da etiqueta) — formato brasileiro "R$
 * 5,87", "R$5,87" ou até só "5,87" perto de "R$" em outra linha. Etiqueta de
 * supermercado quase sempre tem o preço no formato vírgula + 2 casas, então
 * o regex exige exatamente isso (evita confundir com código de barras, peso
 * em gramas, ou outro número solto na foto). Devolve um número (5.87) ou
 * null se não achar nada com essa cara.
 */
/* ------------------------------------------------------------------------ */
/* IA DE PREÇO — corretor severo, tolerante a letra parecida com dígito      */
/*                                                                            */
/* Pedido específico: a OCR às vezes lê o preço trocando 1 dígito por uma    */
/* LETRA parecida (ex.: lê "A1,02" quando a etiqueta diz "41,02" — o "4"      */
/* saiu com cara de "A"). O extrator antigo exigia dígito de verdade         */
/* (\d) em toda a extensão do número, então esses casos eram simplesmente    */
/* PERDIDOS — o app não achava preço nenhum na etiqueta. Este corretor       */
/* aceita, no lugar de cada dígito, tanto o dígito de verdade quanto uma     */
/* letra com cara de dígito (mesma ideia do corretor de ML/KG que já existe  */
/* mais abaixo, só que aplicada aqui ao preço) — e SÓ aceita o resultado se  */
/* a forma reconstruída tiver mesmo cara de preço (vírgula/ponto + 2 casas), */
/* nunca em qualquer número solto.                                          */
/*                                                                            */
/* Por que "A" entra aqui mas NÃO entra no corretor de palavra normal (ver   */
/* OCR_DIGIT_LOOKALIKES mais abaixo, que deliberadamente NÃO inclui A/C/E/R  */
/* por serem letras comuns demais em português): aqui o contexto é bem mais */
/* estreito — só conta se o pedaço inteiro tiver o FORMATO de preço (dígitos */
/* + vírgula/ponto + exatamente 2 casas decimais no fim), então o risco de   */
/* atropelar uma palavra de verdade é muito menor do que seria no texto      */
/* solto do nome do produto.                                                */
/* ------------------------------------------------------------------------ */

const PRICE_DIGIT_LOOKALIKES = {
  O: '0', D: '0', Q: '0',
  I: '1', L: '1',
  Z: '2',
  E: '3', // E → 3 (barras horizontais parecidas, brilho apaga parte do E)
  A: '4', // A → 4 (fonte de impressão térmica desgastada)
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};
const PRICE_CHAR_CLASS = `0-9${Object.keys(PRICE_DIGIT_LOOKALIKES).join('')}`;

/** Converte 1 caractere pro dígito real (dígito de verdade passa direto). */
function priceCharToDigit(ch) {
  if (/\d/.test(ch)) return ch;
  return PRICE_DIGIT_LOOKALIKES[ch] ?? null;
}

/**
 * Reconstrói um pedaço "com cara de preço" (dígitos reais + letras parecidas
 * com dígito, mais vírgula/ponto) pro número de verdade — e conta quantas
 * letras precisaram ser trocadas, pra medir o quão arriscada foi a leitura
 * (usado logo abaixo pra decidir se confia sozinho ou não).
 */
function rebuildPriceChunk(chunk) {
  let rebuilt = '';
  let swapped = 0;
  for (const ch of chunk) {
    if (ch === ',' || ch === '.') {
      rebuilt += ch;
      continue;
    }
    const digit = priceCharToDigit(ch);
    if (digit === null) return null; // nunca deveria acontecer (regex só captura char da classe), mas é trava extra de segurança
    if (digit !== ch) swapped += 1;
    rebuilt += digit;
  }
  return { value: rebuilt, swapped };
}

/**
 * Acha um PREÇO no texto lido (OCR da etiqueta) — formato brasileiro "R$
 * 5,87", "R$5,87" ou até só "5,87" perto de "R$" em outra linha. Etiqueta de
 * supermercado quase sempre tem o preço no formato vírgula + 2 casas, então
 * o regex exige exatamente isso (evita confundir com código de barras, peso
 * em gramas, ou outro número solto na foto). Tolera 1 ou mais dígitos terem
 * saído como letra parecida (ver bloco grande acima). Devolve um número
 * (5.87) ou null se não achar nada com essa cara.
 *
 * v6 — melhorias de detecção de preço:
 *  • Aceita "RS", "R5", "R S", "R $" como variantes OCR de "R$"
 *    (a câmera às vezes confunde "$" com "S" ou "5" — muito comum em
 *    etiquetas impressas com tinta pouco contrastante)
 *  • Aceita separador de milhar no preço (ex.: "R$ 1.234,56")
 *  • Prioridade 3: preço perto das palavras PRECO / VALOR / VLR / UNIT
 *    (comum em etiqueta de gôndola com campo de preço rotulado)
 *  • Maior tolerância de caracteres entre o símbolo e o número (até 4)
 *    para compensar ruído de reflexo entre o cifrão e o dígito
 */
function extractPriceFromText(text) {
  // v6: pré-processa o texto bruto antes de normalizar pro upper
  const processed = preProcessOcrRaw(text ?? '');
  const upper = processed.toString().toUpperCase();

  // Variantes OCR de "R$": aceita "RS", "R5", "R$", "R S", "R $"
  // O "5" é confusão com "$" em impressão térmica; o espaço entre R e $ é
  // ruído de OCR em fontes condensadas de etiqueta de supermercado.
  const RS_VARIANTS = 'R\\s*(?:\\$|S|5)';

  // Prioridade 1: símbolo de preço (R$ ou variante OCR) colado no número.
  // Aceita separador de milhar: "1.234,56" ou "1,234.56".
  // Tolera até 4 caracteres de sujeira entre o símbolo e o número
  // (risco, dois-pontos, espaço, reflexo fantasma).
  const symbolPattern = new RegExp(
    `(?:${RS_VARIANTS})\\s*[^0-9A-Z]{0,4}([${PRICE_CHAR_CLASS}]{1,5}(?:[.,][${PRICE_CHAR_CLASS}]{3})*[.,][${PRICE_CHAR_CLASS}]{2})\\b`,
  );
  const withSymbol = upper.match(symbolPattern);
  if (withSymbol) {
    const rebuilt = rebuildPriceChunk(withSymbol[1]);
    const parsed = rebuilt ? parseBRLNumber(rebuilt.value) : null;
    if (parsed !== null && parsed >= 0.01 && parsed <= 99999) return parsed;
  }

  // Prioridade 2: preço perto de palavra-chave de preço (PRECO, VALOR, VLR,
  // UNIT, UNITARIO, R$ etc.) — comum em etiqueta de gôndola com rótulo de campo.
  // Busca a palavra-chave e captura o primeiro número X,XX que aparece até
  // 40 caracteres depois dela.
  const keywordPricePattern = new RegExp(
    `(?:PRECO|VALOR|VLR|UNIT|UNITARIO|POR|EACH)\\s*.{0,40}?([${PRICE_CHAR_CLASS}]{1,5}(?:[.,][${PRICE_CHAR_CLASS}]{3})*[.,][${PRICE_CHAR_CLASS}]{2})\\b`,
  );
  const nearKeyword = upper.match(keywordPricePattern);
  if (nearKeyword) {
    const rebuilt = rebuildPriceChunk(nearKeyword[1]);
    const parsed = rebuilt ? parseBRLNumber(rebuilt.value) : null;
    if (parsed !== null && parsed >= 0.01 && parsed <= 99999) return parsed;
  }

  // Prioridade 3 (mais arriscada): número solto no formato X,XX ou X.XX sem
  // o "R$" do lado — só usa se for o ÚNICO candidato nesse formato no texto
  // todo, pra não arriscar pegar o número errado quando há mais de um. Sem
  // o "R$" pra confirmar o contexto, só confia sozinho se no MÁXIMO 1 letra
  // precisou ser trocada por dígito — 2 ou mais letras trocadas sem "R$" por
  // perto é sinal forte demais de coincidência (não é preço de verdade) pra
  // arriscar sem confirmação. Também exclui números que parecem ser volume
  // (terminam em ML, KG, L, G) pra não confundir "500ML" com preço.
  const barePattern = new RegExp(
    `\\b([${PRICE_CHAR_CLASS}]{1,5}(?:[.,][${PRICE_CHAR_CLASS}]{3})*[.,][${PRICE_CHAR_CLASS}]{2})\\b(?!\\s*(?:ML|KG|LT|UN|G|L)\\b)`,
    'g',
  );
  const bareMatches = upper.match(barePattern);
  if (bareMatches && bareMatches.length === 1) {
    const rebuilt = rebuildPriceChunk(bareMatches[0]);
    if (rebuilt && rebuilt.swapped <= 1) {
      const parsed = parseBRLNumber(rebuilt.value);
      if (parsed !== null && parsed >= 0.01 && parsed <= 99999) return parsed;
    }
  }

  return null;
}

/**
 * Converte "1.234,56", "5,87" ou "5.87" (a OCR pode confundir "," com ".")
 * pro número 1234.56 / 5.87. Regra: os ÚLTIMOS 2 dígitos são sempre os
 * centavos — não importa se vieram separados por vírgula ou ponto. Qualquer
 * separador ANTES disso é tratado como separador de milhar e descartado.
 */
function parseBRLNumber(value) {
  const cleaned = value.trim();
  const decimalMatch = cleaned.match(/[.,](\d{2})$/);
  if (!decimalMatch) return null;
  const integerPart = cleaned.slice(0, cleaned.length - 3).replace(/[.,]/g, '');
  const parsed = Number(`${integerPart || '0'}.${decimalMatch[1]}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPackQuantityFromText(text) {
  const upper = (text ?? '').toString();
  // Formato do catálogo é sempre "QUANTIDADE X VOLUME" grudado, tipo
  // "12X200ML" ou "6X350ML" — por isso usa um lookahead de dígito depois do
  // X (não \b, que não bate quando X está colado num número dos dois lados).
  const beforeX = upper.match(/\b(\d{1,3})\s*X\s*(?=\d)/);
  if (beforeX) return parseInt(beforeX[1], 10);
  const afterX = upper.match(/X\s*(\d{1,3})\b/);
  if (afterX) return parseInt(afterX[1], 10);
  const caixaCom = upper.match(/\bCAIXA\s*(?:COM)?\s*(\d{1,3})\b/);
  if (caixaCom) return parseInt(caixaCom[1], 10);
  const cxAbrev = upper.match(/\bC[XZ]\s*(?:COM)?\s*(\d{1,3})\b/);
  if (cxAbrev) return parseInt(cxAbrev[1], 10);
  // Fator extra: etiqueta/rótulo que escreve por extenso "12 UNID", "UNIDADES 6"
  // ou "6UN" sem usar "X" nem "CAIXA" — formato comum em fardo de bebida.
  const unidComContagem = upper.match(/\b(\d{1,3})\s*UNID(?:ADES?)?\b/);
  if (unidComContagem) return parseInt(unidComContagem[1], 10);
  const unidPrefixo = upper.match(/\bUNID(?:ADES?)?\s*(?:COM)?\s*(\d{1,3})\b/);
  if (unidPrefixo) return parseInt(unidPrefixo[1], 10);
  return null;
}

function isLongNeckDescription(descriptionUpper) {
  return /LONG\s*NECK|\bLN\b|\bLAGER\b/.test(descriptionUpper);
}

function classifyPackQuantity(descriptionUpper) {
  const isCacula = /CA[CÇ]ULINHA/.test(descriptionUpper);
  const isBeer = /\bCERVEJA\b/.test(descriptionUpper);
  const isLongneck = isLongNeckDescription(descriptionUpper);
  const isMilk = isMilkDescription(descriptionUpper);

  let quantidade = null;
  if (isCacula) quantidade = 12;
  else if (isBeer && isLongneck) quantidade = 6;
  else if (isBeer) quantidade = 12;
  else if (isMilk) quantidade = 12;

  const needsFardoPrompt = quantidade === null && !isLongneck && !isMilk;
  return { quantidade, needsFardoPrompt };
}

/* ------------------------------------------------------------------------ */
/* NOMEAÇÃO PADRONIZADA — LEITE / CERVEJA / REFRIGERANTE / ÁGUA              */
/* ------------------------------------------------------------------------ */
//
// PROBLEMA QUE ISSO RESOLVE:
// A Cosmos/Bluesoft devolve a "description" exatamente como o FABRICANTE
// cadastrou o produto, que costuma vir bagunçada e fora de ordem, tipo:
//     "LEITE UHT DESNATADO 1 L ITALAC"
// A loja só compra 4 categorias por aqui — leite, cerveja, refrigerante e
// água — então dá pra forçar um "molde" fixo de nome pra essas 4, sempre na
// mesma ordem, fácil de bater o olho na gôndola/etiqueta:
//     "LEITE DESNATADO ITALAC 1LX12"
//
// Qualquer produto que NÃO seja uma dessas 4 categorias passa direto pela
// lógica antiga (produto = description + sufixo), sem risco de bagunçar
// nome de item que o script não reconhece.
//
// BUG DA BLUESOFT (ML no lugar de L): às vezes a descrição vem com a
// unidade errada — tipo "1ML" quando na real é "1L" (ninguém vende leite,
// água, refri ou cerveja em embalagem de 1 mililitro). Sempre que o número
// vier em ML mas for pequeno demais pra fazer sentido físico numa gôndola
// (<= BUG_GUARD_MAX_ML), a gente reinterpreta como litro automaticamente.

const BUG_GUARD_MAX_ML = 50;

/**
 * Deixa o texto em maiúsculas, sem acento, mas SEM remover vírgula/ponto
 * (precisa deles pra não quebrar decimais tipo "1,5L") nem hífen (precisa
 * dele pra bater "COCA-COLA"). Usada só pra detectar categoria/marca/
 * subtipo/volume — não é o texto final exibido.
 */
function toSearchableUpper(text) {
  return (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (Á → A, Ç → C, etc.)
    .toUpperCase()
    .replace(/[^A-Z0-9.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Dicionário de marcas conhecidas por categoria — é só ir adicionando linha
// nova aqui se aparecer alguma marca que o fallback (sobra de texto) não
// está pegando direito.
const BRANDS = {
  LEITE: [
    'ITALAC', 'PIRACANJUBA', 'JUSSARA', 'NINHO', 'TIROL', 'ITAMBE', 'PARMALAT',
    'VIGOR', 'BETANIA', 'LIDER', 'DAVENE', 'VERDE CAMPO', 'ZYMIL', 'LACFREE',
    'CCGL', 'MOCA', 'NESTLE', 'SHEFA', 'BOA NATA', 'FRIMESA', 'DAMARE', 'CANDIDO',
  ],
  CERVEJA: [
    'SKOL', 'BRAHMA', 'ANTARCTICA', 'ITAIPAVA', 'BOHEMIA', 'ORIGINAL', 'PETRA',
    'DEVASSA', 'HEINEKEN', 'BUDWEISER', 'CORONA', 'STELLA ARTOIS', 'EISENBAHN',
    'SPATEN', 'AMSTEL', 'KAISER', 'NOVA SCHIN', 'SCHIN', 'PATAGONIA', 'COLORADO',
    'SERRA MALTE', 'CRYSTAL', 'POLAR', 'XINGU', 'BAVARIA',
  ],
  REFRIGERANTE: [
    'COCA-COLA', 'COCA COLA', 'PEPSI', 'GUARANA ANTARCTICA', 'GUARANA', 'FANTA',
    'SPRITE', 'KUAT', 'SUKITA', 'DOLLY', 'SCHWEPPES', 'H2OH', 'TUBAINA', 'CRUSH',
    'JESUS', 'TONI', 'ITUBAINA', 'FRUKI', 'SOL',
  ],
  AGUA: [
    'CRYSTAL', 'BONAFONT', 'LINDOYA', 'MINALBA', 'INDAIA', 'PRATA', 'SAO LOURENCO',
    'PURISSIMA', 'PERRIER', 'SAO GERALDO', 'LIMPIDA', 'AQUAFINA', 'ITAIPAVA',
  ],
};

// Subtipo/variante por categoria — ordem importa (o primeiro que bater vence).
const SUBTYPES = {
  LEITE: [
    { re: /SEMI\s*DESNATADO/, label: 'SEMIDESNATADO' },
    { re: /DESNATADO/, label: 'DESNATADO' },
    { re: /ZERO LACTOSE|SEM LACTOSE|LACTOSE ZERO/, label: 'ZERO LACTOSE' },
    { re: /INTEGRAL/, label: 'INTEGRAL' },
  ],
  CERVEJA: [
    { re: /PURO MALTE/, label: 'PURO MALTE' },
    { re: /\bIPA\b/, label: 'IPA' },
    { re: /WEISSBIER|\bWEISS\b/, label: 'WEISS' },
    { re: /\bSTOUT\b/, label: 'STOUT' },
    { re: /\bPILSEN\b/, label: 'PILSEN' },
    { re: /SEM ALCOOL|ZERO ALCOOL/, label: 'SEM ALCOOL' },
  ],
  REFRIGERANTE: [
    { re: /\bZERO\b/, label: 'ZERO' },
    { re: /\bDIET\b/, label: 'DIET' },
    { re: /\bLIGHT\b/, label: 'LIGHT' },
    { re: /SEM ACUCAR/, label: 'SEM ACUCAR' },
  ],
  AGUA: [
    { re: /COM GAS|GASEIFICADA/, label: 'COM GAS' },
    { re: /SEM GAS/, label: 'SEM GAS' },
  ],
};

// Embalagem — vale a pena manter no nome porque (a) ajuda a identificar o
// produto na gôndola e (b) no caso da cerveja muda até a quantidade padrão
// do fardo (long neck = 6, o resto = 12).
const CONTAINERS = [
  { re: /LONG\s*NECK|\bLN\b/, label: 'LONG NECK' },
  { re: /\bLATA\b/, label: 'LATA' },
  { re: /\bPET\b/, label: 'PET' },
  { re: /\bGARRAFA\b|\bVIDRO\b/, label: 'GARRAFA' },
];

// Palavras que sabidamente NÃO são marca — usadas só quando o produto não
// bate em nenhuma marca do dicionário acima, pra "sobrar" só a marca real.
const NOISE_WORDS = [
  'UHT', 'PASTEURIZADO', 'HOMOGENEIZADO', 'LONGA VIDA', 'ESTERILIZADO',
  'TIPO A', 'TIPO C', 'TETRA PAK', 'CAIXA', 'CX', 'PACOTE', 'PCT', 'UNIDADE',
  'UND', 'UNID', 'UN', 'RETORNAVEL', 'ONE WAY', 'TRADICIONAL',
  'ORIGINAL', 'EXTRA', 'CERVEJARIA', 'SABOR', 'REFRIGERANTE', 'REFRI',
  'AGUA', 'MINERAL', 'NATURAL', 'GASEIFICADA', 'LEITE', 'CERVEJA',
];

function findBrand(searchableUpper, brandList) {
  const sorted = [...(brandList || [])].sort((a, b) => b.length - a.length);
  for (const brand of sorted) {
    if (searchableUpper.includes(brand)) return brand;
  }
  return null;
}

/** Marca "sobrando" no texto depois de tirar categoria/subtipo/ruído/volume. */
function extractBrandFallback(searchableUpper, category) {
  let leftover = searchableUpper;
  leftover = leftover.replace(/\d+(?:[.,]\d+)?\s*(ML|L)\b/g, ' ');
  leftover = leftover.replace(/X\s*\d+\b/g, ' ');
  for (const rule of SUBTYPES[category] || []) leftover = leftover.replace(rule.re, ' ');
  for (const rule of CONTAINERS) leftover = leftover.replace(rule.re, ' ');
  for (const word of NOISE_WORDS) {
    leftover = leftover.replace(new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ');
  }
  leftover = leftover.replace(/\s+/g, ' ').trim();
  return leftover || null;
}

function extractBrand(searchableUpper, category) {
  return findBrand(searchableUpper, BRANDS[category]) || extractBrandFallback(searchableUpper, category);
}

function extractSubtype(searchableUpper, category) {
  for (const rule of SUBTYPES[category] || []) {
    if (rule.re.test(searchableUpper)) return rule.label;
  }
  return null;
}

function extractContainer(searchableUpper) {
  for (const rule of CONTAINERS) {
    if (rule.re.test(searchableUpper)) return rule.label;
  }
  return null;
}

/**
 * Identifica se a descrição é LEITE, CERVEJA, REFRIGERANTE ou ÁGUA.
 * Retorna null pra qualquer outra coisa (produto passa pela lógica antiga).
 */
function detectProductCategory(searchableUpper) {
  const isDairyButNotMilkCarton =
    /LEITE DE COCO|LEITE CONDENSADO|CREME DE LEITE|LEITE FERMENTADO|ACHOCOLATADO/.test(searchableUpper);
  if (/\bLEITE\b/.test(searchableUpper) && !isDairyButNotMilkCarton) return 'LEITE';
  if (/\bCERVEJA\b/.test(searchableUpper)) return 'CERVEJA';
  if (/\bAGUA\b/.test(searchableUpper) || findBrand(searchableUpper, BRANDS.AGUA)) return 'AGUA';
  if (/\bREFRIGERANTE\b|\bREFRI\b/.test(searchableUpper) || findBrand(searchableUpper, BRANDS.REFRIGERANTE)) {
    return 'REFRIGERANTE';
  }
  return null;
}

/**
 * Extrai o volume em ML, já corrigindo o bug da Bluesoft (ML pequeno demais
 * que na real é L). Usa a PRIMEIRA ocorrência de número+unidade no texto.
 */
function extractVolumeSmart(searchableUpper, category) {
  const match = searchableUpper.match(/(\d+(?:[.,]\d+)?)\s*(ML|L)\b/);
  if (!match) return null;

  const rawNumber = parseFloat(match[1].replace(',', '.'));
  const unit = match[2];

  if (unit === 'L') return Math.round(rawNumber * 1000);

  // unit === 'ML'
  const isBugCategory = category === 'LEITE' || category === 'AGUA' || category === 'REFRIGERANTE' || category === 'CERVEJA';
  if (isBugCategory && rawNumber <= BUG_GUARD_MAX_ML) {
    // "1ML"/"2ML" não existe fisicamente numa gôndola pra essas categorias —
    // é a Bluesoft perdendo o L. Reinterpreta como litro.
    return Math.round(rawNumber * 1000);
  }
  return Math.round(rawNumber);
}

/**
 * Anexa o sufixo de fardo no fim do nome, no formato combinado com a loja:
 * QUANTIDADE x VALOR — ex.: "6X2L" (fardo com 6 unidades de 2L cada) ou
 * "6X250ML" (fardo com 6 unidades de 250ml cada). Quando não há quantidade
 * de fardo (produto vendido/comprado avulso, ou ainda não informado), anexa
 * só o volume ("2L", "500ML"), sem X nenhum.
 *
 * Regra vale pra QUALQUER produto — não só leite/cerveja/água/refrigerante.
 * Evita duplicar se o nome já terminar com esse mesmo sufixo.
 */
function appendPackSuffix(name, ml, quantidade) {
  const base = (name || '').replace(/\s+/g, ' ').trim();
  if (ml === null || ml === undefined) return base;

  const volumeLabel = formatVolume(ml);
  const suffix = quantidade && quantidade > 1 ? `${quantidade}X${volumeLabel}` : volumeLabel;

  if (base.toUpperCase().includes(suffix.toUpperCase())) return base;
  return `${base} ${suffix}`.replace(/\s+/g, ' ').trim();
}

/**
 * Monta o nome padronizado SEM o sufixo de fardo (o sufixo é sempre anexado
 * depois, de forma universal, por appendPackSuffix — ver deriveProductFromCosmos
 * e o handleSubmit da tela de confirmar preço).
 *
 * LEITE e CERVEJA levam o nome da categoria na frente (é assim que a
 * Bluesoft já registra esses dois: "LEITE UHT...", "CERVEJA..."). ÁGUA e
 * REFRIGERANTE começam pela MARCA quando ela é reconhecida (ex.:
 * "COCA-COLA PET"), sem repetir a palavra da categoria — só cai pra
 * "AGUA"/"REFRIGERANTE" quando nenhuma marca foi identificada.
 */
function buildStandardizedName({ category, searchableUpper }) {
  const brand = extractBrand(searchableUpper, category);
  const subtype = extractSubtype(searchableUpper, category);
  const container = extractContainer(searchableUpper);

  let parts;
  if (category === 'CERVEJA') {
    parts = ['CERVEJA', brand, subtype, container];
  } else if (category === 'LEITE') {
    parts = ['LEITE', subtype, brand];
  } else if (category === 'AGUA') {
    parts = [brand || 'AGUA', subtype, container];
  } else {
    parts = [brand || 'REFRIGERANTE', subtype, container];
  }

  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------------ */
/* SEGUNDA OPINIÃO POR IA (GROQ / LLAMA) — limpar o nome do produto          */
/* ------------------------------------------------------------------------ */
//
// As regras acima (categoria + marca + subtipo + embalagem) já resolvem a
// maioria dos casos sozinhas, sem precisar de internet nem IA nenhuma. Isso
// aqui é uma CAMADA A MAIS, opcional: manda a descrição crua da Bluesoft pra
// um modelo de IA (rodando na Groq, que é rápida e tem plano grátis) só pra
// ele cortar o excesso de palavras que o dicionário de regras não previu —
// tipo "COM TAMPA", nome do fabricante por extenso, etc. Exemplo real:
//   "LEITE UHT COM TAMPA ITALAC INTEGRAL 1L"  →  IA devolve  "LEITE ITALAC INTEGRAL"
// O volume ("1L") e o fardo ("X12") NUNCA vêm da IA — isso é sempre
// calculado à parte por appendPackSuffix, matemática de verdade, sem chance
// de a IA inventar um número errado.
//
// Se a chamada falhar por qualquer motivo (sem internet, chave inválida,
// limite de uso estourado, resposta esquisita), a função devolve null e
// quem chamou simplesmente usa o nome feito pelas regras — nunca trava o
// app nem impede de salvar o produto por causa da IA.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 8000;

const GROQ_SYSTEM_PROMPT = [
  'Você organiza nomes de produto de supermercado pra ficarem curtos e fáceis',
  'de ler numa etiqueta de preço, a partir da descrição crua de um cadastro',
  'de código de barras (Bluesoft/Cosmos). Siga estas regras à risca:',
  '1. Responda SÓ com o nome final, em maiúsculas, sem aspas, sem explicação,',
  '   sem comentário nenhum antes ou depois, sem ponto final.',
  '2. NUNCA inclua volume ou peso (L, ML, KG, G) nem quantidade de fardo',
  '   (tipo "X12", "12X"). Isso é calculado à parte, não é trabalho seu.',
  '3. Mantenha só o essencial pra reconhecer o produto na gôndola: categoria',
  '   (leite, cerveja, refrigerante, água, etc., quando fizer sentido),',
  '   marca, e a variante/sabor/tipo (integral, desnatado, zero, pilsen,',
  '   diet, com gás, sem gás, etc.).',
  '4. Remova ruído: "COM TAMPA", "UHT", "TETRA PAK", "RETORNÁVEL", "TIPO A",',
  '   nome do fabricante/razão social por extenso, código de barras, número',
  '   de registro, unidade de venda ("UN", "CX", "PCT").',
  '5. NUNCA invente marca, sabor ou informação que não esteja na descrição',
  '   original. Se não tiver certeza de algo, é melhor omitir do que chutar.',
].join('\n');

/**
 * Pede pra uma IA (Groq/Llama) uma versão mais limpa do "corpo" do nome do
 * produto (sem volume, sem fardo — só marca/tipo). Devolve string em
 * maiúsculas em caso de sucesso, ou `null` se algo deu errado (nesse caso,
 * quem chamou deve usar o nome das regras normalmente).
 */
async function suggestCleanNameWithAI(rawDescription) {
  const description = (rawDescription ?? '').trim();
  if (!description) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 40,
        messages: [
          { role: 'system', content: GROQ_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Descrição original: "${description}"\n\nResponda só com o nome limpo, sem volume e sem fardo.`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    // Sanitização básica da resposta: tira aspas/pontuação de sobra e
    // rejeita respostas absurdamente longas ou que ainda tragam volume —
    // nesses casos é mais seguro confiar no nome das regras.
    const cleaned = text.replace(/^["'“”]+|["'“”.]+$/g, '').trim();
    const looksLikeVolume = /\d\s*(ML|L|KG|G)\b/i.test(cleaned);
    if (!cleaned || cleaned.length > 60 || looksLikeVolume) return null;

    return cleaned.toUpperCase();
  } catch {
    return null; // sem internet, timeout, chave inválida, limite estourado etc.
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Deriva nome/ml/quantidade de um produto Cosmos.
 *
 * REGRA DE VOLUME: quando o volume extraído é >= 1000ml, converte para
 * litros na coluna ML do Baserow (1000 → 1, 2000 → 2). Quando é < 1000ml,
 * mantém em ml (250, 350, 473, 600, etc.). O Baserow nunca guarda 1000 —
 * guarda 1.
 *
 * NOME: se a descrição for identificada como LEITE, CERVEJA, REFRIGERANTE
 * ou ÁGUA, o "corpo" do nome é reconstruído do zero num formato padronizado
 * (ver bloco "NOMEAÇÃO PADRONIZADA" acima). Qualquer outro produto mantém o
 * nome original da Bluesoft. Em TODOS os casos, sem exceção, o sufixo de
 * fardo "QUANTIDADE x VALOR" (ex.: "6X2L", "6X250ML") é anexado no final
 * por appendPackSuffix — essa parte vale pra qualquer produto, não só pras
 * 4 categorias reconhecidas.
 *
 * Esta função em si é 100% baseada em regras (síncrona, sem internet). A
 * "segunda opinião" por IA (suggestCleanNameWithAI) é aplicada depois, por
 * quem chama — ver lookupProduct no componente App.
 */
function deriveProductFromCosmos(cosmos) {
  const description = (cosmos.description ?? '').trim();
  const descriptionUpper = description.toUpperCase();
  const searchableUpper = toSearchableUpper(description);

  const category = detectProductCategory(searchableUpper);
  let ml = extractVolumeSmart(searchableUpper, category);
  const { quantidade, needsFardoPrompt } = classifyPackQuantity(descriptionUpper);

  // Convenção do supermercado: valores >= 1000ml são convertidos para litros
  // na coluna ML do Baserow. Ex.: 1000 → 1 (1L), 2000 → 2 (2L), 1500 → 1.5 (1,5L).
  if (ml !== null && ml >= 1000) {
    const liters = ml / 1000;
    ml = Number.isInteger(liters) ? liters : Math.round(liters * 10) / 10;
  }

  const bodyName = category ? buildStandardizedName({ category, searchableUpper }) : description;
  const produto = appendPackSuffix(bodyName, ml, quantidade);

  return { produto, ml, quantidade, needsFardoPrompt };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — melhor correspondência por similaridade (Levenshtein)  */
/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
/* FATOR EXTRA DE PRECISÃO — DETECTOR DE "RUÍDO" (letras aleatórias)         */
/*                                                                            */
/* Às vezes a OCR lê algo que não é texto nenhum de verdade — risco na       */
/* etiqueta, textura da embalagem, dedo tampando parte da foto — e devolve   */
/* uma sequência de letras sem nexo, tipo "sdwedfrfdfsdcxa". Palavra real do */
/* português (mesmo com erro de OCR) sempre tem vogal espalhada com uma      */
/* frequência mínima e não empilha consoante direto por muito tempo; "lixo"  */
/* de leitura tende a ter quase nenhuma vogal e/ou uma sequência enorme de   */
/* consoante seguida. Detectando isso, o app ANULA essa leitura em vez de    */
/* tentar (e arriscar errar) casar ela com um produto do catálogo — e também */
/* evita gastar chamada de IA/web à toa com lixo.                           */
/* ------------------------------------------------------------------------ */

const VOWELS_SET = new Set(['A', 'E', 'I', 'O', 'U']);

// Abaixo desse tamanho não dá pra confiar no teste de vogal/consoante — tem
// abreviação de verdade sem vogal nenhuma (ML, KG, UN, PET, CX, LN...), então
// só palavras "grandes o suficiente" pra um julgamento seguro entram aqui.
const GIBBERISH_MIN_WORD_LENGTH = 5;
// Português raramente empilha mais que 3-4 consoantes seguidas (ex.:
// "TRANSC-", "INSTR-"); 5+ seguidas é forte sinal de ruído de OCR.
const GIBBERISH_MAX_CONSONANT_RUN = 5;
// Palavra real do português quase sempre tem pelo menos ~1 vogal a cada 6
// letras; abaixo disso é sinal de ruído.
const GIBBERISH_MIN_VOWEL_RATIO = 0.16;
// Se 60% ou mais das palavras "julgáveis" (grandes o suficiente) do texto
// inteiro parecem ruído, o texto inteiro é tratado como ruído.
const GIBBERISH_TEXT_REJECT_RATIO = 0.6;

function longestConsonantRun(word) {
  let longest = 0;
  let current = 0;
  for (const ch of word) {
    if (/[A-Z]/.test(ch) && !VOWELS_SET.has(ch)) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/** Só julga palavra "pura de letra" (A-Z) com tamanho suficiente — número, código, unidade curta nunca entra aqui. */
function isGibberishWord(word) {
  if (word.length < GIBBERISH_MIN_WORD_LENGTH || !/^[A-Z]+$/.test(word)) return false;
  let vowels = 0;
  for (const ch of word) if (VOWELS_SET.has(ch)) vowels += 1;
  if (vowels / word.length < GIBBERISH_MIN_VOWEL_RATIO) return true;
  if (longestConsonantRun(word) >= GIBBERISH_MAX_CONSONANT_RUN) return true;
  return false;
}

/** Remove do texto (já normalizado/maiúsculo) as palavras que parecem ruído — usado só no texto LIDO, nunca no nome do catálogo. */
function stripGibberishWords(normalizedUpperText) {
  const words = normalizedUpperText.split(' ').filter(Boolean);
  const kept = words.filter((w) => !isGibberishWord(w));
  return kept.join(' ');
}

/**
 * Decide se o texto INTEIRO lido (bruto, ainda sem normalizar) parece ser
 * majoritariamente ruído de OCR — usado como "válvula de segurança" logo no
 * começo do pipeline, pra anular de vez a leitura antes de gastar IA/web ou
 * arriscar um casamento por acaso com o catálogo.
 */
function isLikelyNoiseText(rawText) {
  const upper = normalizeProductText(rawText);
  const judgeable = upper.split(' ').filter((w) => w.length >= GIBBERISH_MIN_WORD_LENGTH && /^[A-Z]+$/.test(w));
  if (judgeable.length === 0) return false; // nada grande o suficiente pra julgar — não trava a leitura
  const gibberishCount = judgeable.filter(isGibberishWord).length;
  return gibberishCount / judgeable.length >= GIBBERISH_TEXT_REJECT_RATIO;
}

// FATOR EXTRA DE RECONHECIMENTO — Damerau-Levenshtein (variante "optimal
// string alignment"), não o Levenshtein comum. A diferença: no Levenshtein
// comum, duas letras ADJACENTES trocadas de lugar (ex.: "BRAHAM" em vez de
// "BRAHMA" — o M e o A do fim trocaram de posição) contam como 2 erros
// (2 substituições), então a semelhança despenca e o casamento pode falhar
// mesmo sendo um erro de digitação/OCR muito comum e "de 1 letra só" na
// prática. Aqui, transposição de letra adjacente conta como 1 erro — igual
// já contava substituir/inserir/remover 1 letra — deixando o casamento
// mais preciso pra esse tipo de erro específico, sem precisar de internet
// nem IA pra compensar.
function levenshtein(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Matriz cheia (não só 2 linhas) porque a transposição olha 2 linhas pra
  // trás — strings de produto são curtas (poucas dezenas de caracteres),
  // então o custo extra de memória é irrelevante.
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(
        dp[i - 1][j] + 1, // remoção
        dp[i][j - 1] + 1, // inserção
        dp[i - 1][j - 1] + cost, // substituição (ou igual, custo 0)
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        best = Math.min(best, dp[i - 2][j - 2] + 1); // transposição adjacente
      }
      dp[i][j] = best;
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * FATOR EXTRA DE PRECISÃO — similaridade por bigramas de caracteres (Jaccard).
 * O Levenshtein (função "similarity" acima) compara a string INTEIRA na
 * ordem em que veio — então quando a OCR lê as palavras fora de ordem
 * ("ZERO COCA COLA 200ML" em vez de "COCA COLA ZERO 200ML"), o score de
 * Levenshtein desaba mesmo sendo o produto certo. Bigramas de caractere não
 * ligam pra ordem das PALAVRAS (só das letras dentro de cada par), então
 * pega esse caso que o Levenshtein sozinho perde. Usado como sinal
 * complementar em productTextSimilarity, nunca sozinho.
 */
function charBigramSet(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    set.add(clean.slice(i, i + 2));
  }
  return set;
}

function bigramJaccardSimilarity(a, b) {
  const setA = charBigramSet(a);
  const setB = charBigramSet(b);
  if (setA.size === 0 || setB.size === 0) return setA.size === setB.size ? 1 : 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/*
 * FATOR EXTRA DE DETALHAMENTO — trigrama de caractere (janela de 3 letras).
 * O bigrama (2 letras) já ajuda a resistir a palavra fora de ordem, mas é
 * "grosso" — pega semelhança mesmo entre palavras bem diferentes que só
 * compartilham pares soltos de letra comum (ex.: "AR", "RA"). O trigrama
 * (3 letras) é mais específico: exige um pedaço maior de texto igual pra
 * contar como semelhante, então serve de DESEMPATE mais preciso quando o
 * bigrama e o overlap por palavra ficam próximos entre dois candidatos —
 * útil justamente quando não dá pra confirmar com IA/web (SerpApi fora do
 * ar ou cota esgotada) e o app precisa decidir sozinho, só com o que já
 * tem localmente.
 */
function charTrigramSet(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const set = new Set();
  if (clean.length < 3) return set;
  for (let i = 0; i < clean.length - 2; i += 1) {
    set.add(clean.slice(i, i + 3));
  }
  return set;
}

function trigramJaccardSimilarity(a, b) {
  const setA = charTrigramSet(a);
  const setB = charTrigramSet(b);
  if (setA.size === 0 || setB.size === 0) return 0; // texto curto demais pra ter trigrama: não opina
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const SUGGESTION_THRESHOLD = 0.6;
// Correspondência por NOME/imagem é mais "ruidosa" que por código de barras
// (a OCR erra letra, junta palavra, etc), então o piso de aceitação é um
// pouco mais baixo — mas os multiplicadores de ML/variante abaixo cortam
// qualquer match que pareça o produto errado mesmo com nome parecido.
const TEXT_SUGGESTION_THRESHOLD = 0.5;

// Cache curto de todas as linhas, pra o Modo Inteligente não bater na API do
// Baserow a cada scan (mesma estratégia do backend original, 30s de TTL).
// Inicializa com o snapshot local pra que a primeira busca seja instantânea
// — sem esperar a rede — e o Baserow atualiza o cache assim que responder.
let productsCache = {
  rows: LOCAL_PRODUCTS_SNAPSHOT,
  fetchedAt: 0,       // força refresh na primeira chamada real
  fromSnapshot: true, // flag pra saber se é o fallback local
};
const PRODUCTS_CACHE_TTL_MS = 30000; // 30s (era 15s — reduz chamadas à API)

/* ------------------------------------------------------------------------ */
/* CACHE DE FREQUÊNCIA DE TOKENS — calculado UMA VEZ, reutilizado            */
/*                                                                            */
/* Antes era recalculado dentro de findBestMatchByProductText a cada scan —  */
/* ou seja, a cada ~1.1s no modo tempo real (LIVE_MATCH_THROTTLE_MS). Como   */
/* o catálogo não muda durante uma sessão, calculamos uma vez e guardamos.   */
/* Invalida junto com o productsCache (quando produtos novos são cadastrados).*/
/* ------------------------------------------------------------------------ */
let _tokenFrequencyCache = null; // { df, totalProducts, rowCount }

function getTokenFrequency(rows) {
  const count = rows.length;
  if (_tokenFrequencyCache && _tokenFrequencyCache.rowCount === count) {
    return _tokenFrequencyCache;
  }
  const freq = buildTokenDocumentFrequency(rows);
  _tokenFrequencyCache = { ...freq, rowCount: count };
  return _tokenFrequencyCache;
}

function invalidateTokenFrequencyCache() {
  _tokenFrequencyCache = null;
}

// FATOR EXTRA DE CONFIABILIDADE — cache "stale-while-revalidate".
//
// Bug relatado: além do fetch sem timeout (corrigido acima), havia uma
// segunda causa pro "fica em loading": mesmo com o comentário aqui do lado
// dizendo que a PRIMEIRA busca deveria ser instantânea (usando o snapshot
// local embutido no app), a implementação antiga não fazia isso de verdade
// — sempre que o cache estava "vencido" (a cada 30s, ou logo na primeira
// chamada, já que fetchedAt começa em 0), a função dava `await` direto na
// rede ANTES de devolver qualquer coisa. Ou seja: toda vez que o cache
// vencia, TODAS as camadas de reconhecimento (direto, sílaba, letras em
// comum...) ficavam paradas esperando o Baserow responder — e se a rede
// estivesse ruim, essa espera podia demorar bastante (agora, no máximo,
// os BASEROW_TIMEOUT_MS de cima, mas ainda assim trava a leitura por até
// 8s a cada 30s de uso).
//
// Correção de verdade: SEMPRE devolve o que já está em cache NA HORA (nunca
// espera rede), mesmo que esteja "vencido" — e dispara a atualização real
// em SEGUNDO PLANO, sem bloquear ninguém. Assim o escaneamento nunca fica
// esperando o Baserow responder; na pior das hipóteses, usa dados de até
// 30s+ atrás (praticamente irrelevante pra catálogo de supermercado, que
// não muda a cada segundo) enquanto a atualização acontece por trás.
let productsRefreshInFlight = null; // evita disparar 2+ atualizações em paralelo

function refreshProductsInBackground() {
  if (productsRefreshInFlight) return productsRefreshInFlight; // já tem uma rodando — reaproveita
  productsRefreshInFlight = listAllProductsRaw()
    .then((rows) => {
      productsCache = { rows, fetchedAt: Date.now(), fromSnapshot: false };
      invalidateTokenFrequencyCacheIfCountChanged(rows.length);
      return rows;
    })
    .catch(() => null) // falha silenciosa — quem já tem cache nem percebe, tenta de novo no próximo ciclo
    .finally(() => {
      productsRefreshInFlight = null;
    });
  return productsRefreshInFlight;
}

// A frequência de token (idf) é calculada por CONTAGEM de produto (ver
// getTokenFrequency) — se o catálogo mudou de tamanho depois de um refresh
// em segundo plano, força o recálculo pra não ficar com peso desatualizado.
function invalidateTokenFrequencyCacheIfCountChanged(newCount) {
  if (_tokenFrequencyCache && _tokenFrequencyCache.rowCount !== newCount) {
    _tokenFrequencyCache = null;
  }
}

async function listAllProductsCached() {
  const now = Date.now();

  // JÁ TEM CACHE (mesmo vencido)? Devolve NA HORA — nunca espera rede. Se
  // estiver vencido, dispara atualização em segundo plano (sem "await" de
  // propósito) pra da próxima vez já estar fresco, mas o escaneamento ATUAL
  // não fica esperando por isso.
  if (productsCache) {
    if (now - productsCache.fetchedAt >= PRODUCTS_CACHE_TTL_MS) {
      refreshProductsInBackground();
    }
    return productsCache.rows;
  }

  // Só cai aqui se productsCache nunca foi inicializado (não deveria
  // acontecer, já que é inicializado com o snapshot local lá em cima — mas
  // fica como rede de segurança). Com timeout (BASEROW_TIMEOUT_MS) pra
  // nunca travar pra sempre; se falhar, cai pro snapshot local embutido.
  try {
    const rows = await listAllProductsRaw();
    productsCache = { rows, fetchedAt: now, fromSnapshot: false };
    return rows;
  } catch {
    productsCache = { rows: LOCAL_PRODUCTS_SNAPSHOT, fetchedAt: now - PRODUCTS_CACHE_TTL_MS + 5000, fromSnapshot: true };
    return productsCache.rows;
  }
}

function invalidateProductsCache() {
  // Preserva o snapshot local mas força refresh do Baserow na próxima chamada.
  productsCache = { rows: LOCAL_PRODUCTS_SNAPSHOT, fetchedAt: 0, fromSnapshot: true };
  invalidateTokenFrequencyCache(); // token frequency deve ser recalculada junto
}

async function findBestMatchByCodigo(codigo) {
  const rows = await listAllProductsCached();
  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    if (!row.codigo) continue;
    const score = similarity(codigo, row.codigo);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best || bestScore < SUGGESTION_THRESHOLD) {
    return { found: false, score: bestScore < 0 ? null : bestScore, product: null };
  }
  return { found: true, score: bestScore, product: best };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE (IMAGEM) — casamento por NOME, com peso pra ML/variante  */
/*                                                                            */
/* Diferença chave pro casamento por código de barras: aqui a gente NÃO pode */
/* confiar só em "o texto parece parecido", porque "COCA COLA" e "COCA COLA  */
/* ZERO" são MUITO parecidos como string, mas são produtos diferentes. Por   */
/* isso a similaridade final leva em conta:                                 */
/*  1) CORRETOR SEVERO de número-disfarçado-de-letra da OCR (ver abaixo) —   */
/*     roda ANTES de tudo, então os itens 2-5 já trabalham em cima do texto  */
/*     corrigido.                                                           */
/*  2) similaridade de string "crua" (Levenshtein) — pega erro de OCR/typo  */
/*  3) sobreposição de palavras "tolerante" (fuzzy token overlap) — pega     */
/*     ordem trocada E também 1-2 letras erradas dentro da própria palavra   */
/*     (ex.: "ITAL4C" ainda conta como "ITALAC")                            */
/*  4) ML extraído do texto (473ML x 350ML) — se os dois têm ML e é         */
/*     diferente, penaliza pesado (não é o mesmo item mesmo com nome igual) */
/*  5) "palavras-variante" (ZERO, DIET, LIGHT, LATA, GARRAFA, PET, LN/LONG  */
/*     NECK, SEM AÇÚCAR, INTEGRAL, DESNATADO...) — se um texto tem e o      */
/*     outro não, penaliza (evita confundir Coca-Cola com Coca-Cola Zero)   */
/* ------------------------------------------------------------------------ */

const VARIANT_KEYWORDS = [
  'ZERO', 'DIET', 'LIGHT', 'SEM ACUCAR', 'SEM LACTOSE',
  'LATA', 'GARRAFA', 'PET', 'VIDRO',
  'LONG NECK', 'LN', 'LAGER', 'PILSEN', 'IPA',
  'INTEGRAL', 'DESNATADO', 'SEMIDESNATADO',
  'TRADICIONAL', 'ORIGINAL',
  // v6 — variantes adicionais frequentes em rótulo de supermercado
  'EXTRA', 'GOLD', 'PREMIUM', 'CLASSIC', 'ESPECIAL',
  'NATURAL', 'ORGANICO', 'SEM GLUTEN', 'VEGANO',
  'SUAVE', 'FORTE', 'CONCENTRADO',
  'CREME', 'LIQUIDO', 'EM PO', 'SOLAVEL',
];

/* ---- CORRETOR SEVERO: número que a OCR leu como letra parecida ---------- */
//
// O problema relatado: a OCR às vezes lê "500ML" como "S00 ML" (o "5" virou
// "S"), ou "350" como "35O" (o "0" virou "O"). Isso quebra a extração de ML
// (extractMl não reconhece "S00" como número) e também o casamento por
// palavra (o token "S00" não bate com "500" no banco).
//
// A correção precisa ser CIRÚRGICA — trocar letra por número em QUALQUER
// lugar do texto seria perigoso: uma marca de cerveja real chamada "SKOL"
// tem justamente S, O e L, que são 3 das letras mais parecidas com dígito
// (5, 0, 1)! Se a gente trocasse isso à toa, "SKOL" virava "5K01" e o
// casamento ficava pior, não melhor. Por isso as regras abaixo SÓ mexem no
// pedaço de texto que já está grudado numa unidade de medida (ML, L, KG,
// UN, G) ou num "X" de fardo seguido de dígito — ou seja, só em lugar que
// já tem certeza absoluta de que ali é pra ser um número. Uma palavra como
// "SKOL", "SOL", "SAL" etc. nunca aparece colada direto numa unidade desse
// jeito, então nunca é tocada.
const OCR_DIGIT_LOOKALIKES = {
  O: '0', D: '0', Q: '0',
  I: '1', L: '1',
  Z: '2',
  E: '3', // E → 3 em fontes condensadas de etiqueta (barras horizontais lembram o "3")
  A: '4', // A → 4 (ângulo do A sem a barra do meio, comum em impressão desgastada)
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};

/**
 * Tenta reescrever um pedaço de texto como se fosse 100% número, trocando
 * cada letra pelo dígito parecido (O→0, S→5, I→1, etc). "X" passa direto
 * (é o multiplicador de fardo, tipo "6X350", não é número disfarçado).
 * Se aparecer QUALQUER letra que não tem um dígito parecido óbvio (tipo A,
 * C, E, R...), desiste e devolve null — mais seguro não mexer do que
 * arriscar estragar uma palavra de verdade.
 */
function tryFixNumericChunk(chunk) {
  let rebuilt = '';
  for (const ch of chunk) {
    if (/\d/.test(ch) || ch === 'X') {
      rebuilt += ch;
      continue;
    }
    const swap = OCR_DIGIT_LOOKALIKES[ch];
    if (swap === undefined) return null;
    rebuilt += swap;
  }
  return rebuilt;
}

/**
 * Corretor severo: procura números disfarçados de letra bem perto de uma
 * unidade de medida ou de um "X" de fardo, e corrige SÓ ali.
 *   "S00 ML"      -> "500 ML"
 *   "6X33OML"     -> "6X330ML"
 *   "AGUA... 5OO L" -> "AGUA... 500 L"   (só corrige com espaço real separando)
 * Nunca mexe em palavra normal (ver comentário acima do OCR_DIGIT_LOOKALIKES).
 */
function fixOcrNumberLookalikes(normalizedText) {
  let text = normalizedText;

  // 1a) o número do VOLUME, quando vem colado ou perto de unidade de 2+
  //     letras (ML, KG, UN). Essas são seguras mesmo SEM espaço separando
  //     (ex.: "6X33OML" -> "6X330ML"), porque não existe palavra comum do
  //     português que termine exatamente em "ML"/"KG"/"UN".
  //     Quantificador NÃO-guloso ({1,6}?) é importante: evita que "L"
  //     (também tratado abaixo) "roube" o M de "ML" durante o backtracking.
  text = text.replace(/\b([A-Z0-9]{1,6}?)(\s*)(ML|KG|UN)\b/g, (full, chunk, gap, unit) => {
    const fixed = tryFixNumericChunk(chunk);
    return fixed ? `${fixed}${gap}${unit}` : full;
  });

  // 1b) o número do VOLUME perto de unidade de 1 letra só (L de litro, G de
  //     grama). Essa é BEM mais arriscada: muita palavra comum do
  //     português termina em "L" ou "G" — inclusive marca de verdade, tipo
  //     a cerveja "SOL" (S-O-L são justamente 3 letras parecidas com
  //     número!). Por isso aqui só corrige quando tem um ESPAÇO de verdade
  //     separando o número da unidade (ex.: "500 L") — nunca quando a letra
  //     está grudada dentro da própria palavra (protege "SOL", "GOL",
  //     "MEL" etc. de virarem número por engano).
  text = text.replace(/\b([A-Z0-9]{1,6}?)(\s+)(L|G)\b/g, (full, chunk, gap, unit) => {
    const fixed = tryFixNumericChunk(chunk);
    return fixed ? `${fixed}${gap}${unit}` : full;
  });

  // Propositalmente NÃO existe uma "parte 2" tentando corrigir a
  // QUANTIDADE de fardo antes do "X" (tipo "GX350ML" -> "6X350ML"). Testei
  // e essa ideia parecia boa, mas quebrava um padrão real e comum do banco
  // de vocês: "1LX12" (1 Litro, fardo com 12) — o "L" ali é uma unidade de
  // verdade, não um número mal lido, e um corretor de quantidade-antes-do-X
  // não consegue distinguir com segurança os dois casos. Como o problema
  // relatado era especificamente no VOLUME (que a regra acima já resolve),
  // preferi deixar a quantidade de fardo sem correção automática a arriscar
  // estragar um nome que já estava certo.

  return text;
}

/* ---- CORRETOR SEVERO: palavra parecida que a OCR grafou errado ---------- */
//
// Problema relatado: a OCR às vezes lê "ZERO" como "ZELO" (R↔L, letras com
// formato parecido), "ZLERO" (letra a mais no meio) ou "ZTERO" (T
// intrometido) — troca/inserção de 1 letra dentro da própria palavra. Isso
// já vinha quebrando o casamento de "variante" (extractVariantSet, mais
// abaixo): ele só reconhecia "ZERO" com grafia EXATA, então uma foto com
// "ZELO" era tratada como se não tivesse variante nenhuma, e o produto Zero
// podia ser confundido com o produto normal (ou penalizado por engano).
//
// Em vez de cadastrar cada erro possível um por um (ZELO, ZLERO, ZTERO,
// ZERQ, ZEBO, ZER0, ...— a lista nunca acaba), este corretor testa CADA
// PALAVRA do texto lido contra a lista de "palavras-alvo" (as mesmas
// VARIANT_KEYWORDS de 1 palavra só, mais algumas outras bem comuns em
// rótulo) usando Levenshtein (a função "similarity" mais abaixo no
// arquivo). Se a palavra lida está muito parecida (>= WORD_LOOKALIKE_
// THRESHOLD) de uma palavra-alvo, ela é TROCADA pela grafia certa. Isso
// resolve automaticamente qualquer variação de 1 letra errada/a mais/a
// menos, sem precisar prever o erro específico.
//
// Por que é "severo" e ainda assim seguro:
//  • só entra em ação se a palavra lida NÃO é já uma das palavras-alvo
//    (evita processamento à toa em texto que já veio certo);
//  • só compara com alvo de tamanho parecido (diferença de até 2
//    caracteres) — não deixa uma palavra pequena virar uma bem maior;
//  • ignora palavra com menos de 3 letras (palavra curta demais teria
//    "sim" alto com qualquer coisa, gerando falso positivo);
//  • o piso de aceitação (0,74) é ligeiramente mais alto que o piso geral
//    de fuzzy do app (0,72 — ver FUZZY_TOKEN_MATCH_THRESHOLD mais abaixo),
//    ou seja, só troca quando a semelhança é MUITO forte (tipicamente 1
//    letra trocada/a mais/a menos numa palavra curta) — reduz o risco de
//    "corrigir" uma palavra que só por coincidência ficou parecida.
const WORD_LOOKALIKE_THRESHOLD = 0.74;

// Nota de ordem: esta constante é lida dentro de fixWordLookalikes, que só
// RODA em tempo de execução (nunca no carregamento do arquivo) — então não
// tem problema estar sendo declarada aqui em cima e usada abaixo antes de
// VARIANT_KEYWORDS existir "por escrito" mais adiante no arquivo; quando a
// função de fato roda, VARIANT_KEYWORDS já foi montada. Mesmo assim, para
// deixar claro e evitar qualquer confusão de leitura, a lista de alvos é
// resolvida dentro da própria função (lazy), não aqui fora.
function wordLookalikeTargets() {
  const singleWordVariants = VARIANT_KEYWORDS.filter((k) => !k.includes(' '));
  // Além das palavras-variante (ZERO, DIET, LIGHT...), estas outras também
  // aparecem MUITO em rótulo de supermercado e a OCR erra elas com
  // frequência parecida — vale corrigir do mesmo jeito.
  const extras = [
    'REFRIGERANTE', 'CERVEJA', 'GARRAFA', 'LATA', 'FARDO', 'CAIXA',
    // v6 — termos adicionais muito comuns em rótulo de supermercado
    'ACHOCOLATADO', 'LEITE', 'SUCO', 'AGUA', 'ENERGETICO', 'ISOTÔNICO',
    'IOGURTE', 'MANTEIGA', 'QUEIJO', 'BISCOITO', 'BOLACHA',
    'AZEITE', 'OLEO', 'VINAGRE', 'MOLHO', 'MAIONESE',
    'ARROZ', 'FEIJAO', 'MACARRAO', 'FARINHA', 'ACUCAR', 'SAL',
    'DETERGENTE', 'SABAO', 'AMACIANTE', 'SABONETE', 'SHAMPOO',
  ];
  // FATOR EXTRA DE RECONHECIMENTO — marca também entra na correção de
  // palavra parecida. A marca é o sinal MAIS decisivo de todo o casamento
  // (ver BRAND_POSITION_BOOST e o peso por raridade/idf, mais abaixo): é o
  // que diferencia "COCA-COLA ZERO" de "GUARANÁ ZERO" quando o resto do
  // texto (ZERO, PET, REFRI...) é genérico. Se a OCR erra 1 letra bem no
  // nome da marca (ex.: "HEIMEKEN" em vez de "HEINEKEN", "BRAHAM" em vez de
  // "BRAHMA"), sem essa correção o app perdia justamente o sinal mais forte
  // que tinha — e ficava mais dependente de IA/busca web pra compensar.
  // Corrigindo aqui, o casamento direto (que não usa internet nenhuma)
  // resolve sozinho a maioria desses casos.
  const brandWords = [
    ...BRANDS.LEITE, ...BRANDS.CERVEJA, ...BRANDS.REFRIGERANTE, ...BRANDS.AGUA,
  ]
    .flatMap((brand) => brand.replace(/-/g, ' ').split(' '))
    .filter((word) => word.length >= 3);
  return [...new Set([...singleWordVariants, ...extras, ...brandWords])];
}

// FATOR EXTRA DE VELOCIDADE — wordLookalikeTargets() monta essa lista
// combinando VARIANT_KEYWORDS + BRANDS inteiro toda vez que é chamada, mas
// nenhuma dessas duas coisas muda depois que o app carrega — então calcular
// de novo a cada chamada (que acontece a cada palavra de cada produto do
// catálogo, ver fixWordLookalikes) é trabalho jogado fora. Calcula uma vez
// só e reaproveita pro resto da sessão.
let _wordLookalikeTargetsCache = null;
function wordLookalikeTargetsCached() {
  if (!_wordLookalikeTargetsCache) {
    _wordLookalikeTargetsCache = wordLookalikeTargets();
  }
  return _wordLookalikeTargetsCache;
}

/* ---- FILTRO DE REFLEXO DE LUZ: dígito aparecendo no meio de palavra ----- */
//
// Problema relatado: reflexo de luz na etiqueta (foto tirada com brilho
// batendo em cima do texto) apaga PARTE de uma letra — e a OCR, vendo só o
// pedacinho que sobrou, lê como se fosse um dígito parecido. Exemplo dado:
// "ZERO" vira "ZER9" (o brilho lava a curva de baixo do "O", sobra só o
// arco de cima, que a OCR confunde com "9"). É o problema INVERSO do
// corretor de preço (lá, letra virava dígito por causa da fonte; aqui,
// LETRA vira dígito por causa de brilho/reflexo apagando parte dela).
//
// A diferença importante pro corretor de palavra comum (fixWordLookalikes,
// logo abaixo): reflexo pode apagar MAIS de 1 caractere de uma vez (o
// brilho costuma cobrir uma área, não uma letra só), então uma comparação
// "fuzzy" comum (que só tolera ~1 erro numa palavra curta) pode não ser
// parecida o suficiente pra bater. Este filtro RECONSTRÓI a palavra inteira
// trocando cada dígito pela letra parecida (0→O, 9→O, 1→I, 2→Z, 5→S, 6→G,
// 7→T, 8→B) e testa se o resultado bate EXATO com uma palavra conhecida —
// isso funciona mesmo com vários dígitos de reflexo na mesma palavra,
// porque não depende de "quão parecido" ficou, só de reconstruir a palavra
// certa.
const DIGIT_TO_LETTER_LOOKALIKES = {
  0: 'O', 9: 'O', // 9 é o caso citado (ZER9 -> ZERO) — o "rabinho" do 9 lembra o traço que o brilho deixa
  1: 'I',
  2: 'Z',
  3: 'E', // 3 invertido lembra E (brilho pode apagar a barra vertical do E)
  4: 'A', // 4 tem forma de A em certas fontes de etiqueta
  5: 'S',
  6: 'G',
  7: 'T',
  8: 'B',
};

/**
 * Tenta reconstruir uma palavra corrompida por reflexo (letra virou dígito
 * parecido) pra grafia normal — só entra em ação se a palavra tiver LETRA E
 * DÍGITO misturados (sinal forte de corrupção parcial, não um código ou
 * número de verdade). Se algum dígito não tiver letra parecida conhecida,
 * desiste — não arrisca inventar.
 *
 * v6: tenta também reconstrução PARCIAL quando só 1 ou 2 dígitos "órfãos"
 * aparecem numa palavra predominantemente alfabética — brilho/reflexo
 * costuma afetar 1-2 letras de uma vez, não a palavra inteira.
 */
function reflectionDeglare(word) {
  if (!/[A-Z]/.test(word) || !/[0-9]/.test(word)) return null;

  // Tentativa 1: reconstrução total (todos os dígitos têm letra equivalente)
  let rebuilt = '';
  let failed = false;
  for (const ch of word) {
    if (/[A-Z]/.test(ch)) { rebuilt += ch; continue; }
    const letter = DIGIT_TO_LETTER_LOOKALIKES[ch];
    if (!letter) { failed = true; break; }
    rebuilt += letter;
  }
  if (!failed) return rebuilt;

  // Tentativa 2: reconstrução PARCIAL — aceita dígitos sem letra equivalente
  // (3 e 4 agora têm mapeamento em v6; esta tentativa trata casos futuros
  // onde um novo dígito ainda não mapeado aparece no meio da palavra). Só
  // usa o resultado se a palavra inteira ficou pelo menos 80% alfabética
  // após a conversão — sinal de que era mesmo texto, não número.
  let rebuilt2 = '';
  let digits = 0;
  for (const ch of word) {
    if (/[A-Z]/.test(ch)) { rebuilt2 += ch; continue; }
    digits += 1;
    const letter = DIGIT_TO_LETTER_LOOKALIKES[ch];
    rebuilt2 += letter ?? ch; // mantém o dígito original se não tem equivalente
  }
  const alphaCount = (rebuilt2.match(/[A-Z]/g) || []).length;
  if (alphaCount / rebuilt2.length >= 0.8 && digits <= 2) return rebuilt2;

  return null;
}

/**
 * v6 — Pré-processamento de texto OCR bruto antes de qualquer etapa:
 * remove lixo comum de reflexo/brilho que aparece como sequência de
 * caracteres repetidos, linhas de traços, ou blocos de espaço enorme.
 * Opera no texto BRUTO (antes de normalizar) — não deve ser chamado
 * no nome do catálogo, só no texto lido pela câmera.
 */
function preProcessOcrRaw(rawText) {
  return (rawText ?? '')
    // Sequências de 3+ caracteres idênticos não-alfanuméricos → espaço
    // (ex.: "---", "===", "|||", "...") — artefatos de brilho/borda de etiqueta
    .replace(/([^A-Za-z0-9\s])\1{2,}/g, ' ')
    // Sequências de 4+ caracteres alfanuméricos idênticos seguidos
    // (ex.: "AAAA", "0000") — muito raro em texto real, quase sempre ruído
    .replace(/([A-Za-z0-9])\1{3,}/g, (m) => m[0])
    // Normaliza quebras de linha e espaçamentos excessivos
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{3,}/g, ' ')
    .trim();
}

function fixWordLookalikes(normalizedUpperText) {
  const targets = wordLookalikeTargetsCached();
  const words = normalizedUpperText.split(' ');
  const fixedWords = words.map((word) => {
    if (word.length < 3) return word;
    if (targets.includes(word)) return word; // já está com a grafia certa

    // FILTRO DE REFLEXO — tenta primeiro reconstruir a palavra trocando
    // dígito por letra parecida (ver reflectionDeglare, logo acima) e
    // confere se bate EXATO com uma palavra-alvo. Prioridade máxima porque
    // é uma reconstrução, não uma aproximação — funciona mesmo se o brilho
    // tiver corrompido mais de 1 caractere na mesma palavra.
    const deglared = reflectionDeglare(word);
    if (deglared && targets.includes(deglared)) return deglared;

    // Corretor fuzzy normal (ver WORD_LOOKALIKE_THRESHOLD acima) — testa
    // tanto a palavra original quanto a versão "sem reflexo" contra cada
    // alvo, fica com a que ficar mais parecida.
    let bestTarget = null;
    let bestSim = 0;
    for (const target of targets) {
      if (Math.abs(word.length - target.length) <= 2) {
        const sim = similarity(word, target);
        if (sim > bestSim) {
          bestSim = sim;
          bestTarget = target;
        }
      }
      if (deglared && Math.abs(deglared.length - target.length) <= 2) {
        const simDeglared = similarity(deglared, target);
        if (simDeglared > bestSim) {
          bestSim = simDeglared;
          bestTarget = target;
        }
      }
    }
    return bestTarget && bestSim >= WORD_LOOKALIKE_THRESHOLD ? bestTarget : word;
  });
  return fixedWords.join(' ');
}

function normalizeProductTextUncached(text) {
  const base = (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Corretor severo — só mexe em número disfarçado de letra perto de
  // unidade/fardo (ver comentário acima). Em texto já limpo (nome cadastrado
  // no Baserow) isso não faz diferença nenhuma; quem se beneficia é o texto
  // vindo da OCR da foto.
  const numberFixed = fixOcrNumberLookalikes(base);

  // Corretor severo de PALAVRA (ZERO, DIET, LIGHT, GARRAFA...) — pega letra
  // trocada/a mais/a menos dentro da própria palavra (ZELO, ZLERO, ZTERO
  // viram ZERO). Ver comentário grande acima de fixWordLookalikes.
  const fixed = fixWordLookalikes(numberFixed);

  // Uniformiza "200 ML" (com espaço) e "200ML" (grudado) pro MESMO formato
  // usado no catálogo (sempre grudado — ver appendPackSuffix). Sem isso, um
  // texto lido que veio com espaço entre o número e a unidade (comum em
  // texto de tela/site, e às vezes até na própria OCR por causa do espaço
  // entre letras) vira um TOKEN diferente de "200ML" e o casamento por
  // palavra falha, mesmo sendo exatamente o mesmo volume.
  return fixed.replace(/\b(\d+(?:[.,]\d+)?)\s+(ML|L|KG|G|UN)\b/g, '$1$2');
}

// FATOR EXTRA DE VELOCIDADE / MENOS TRAVAMENTO — cache transparente pra
// normalizeProductText.
//
// Por que isso importa tanto: toda busca no catálogo (findBestMatchBy...)
// chama normalizeProductText(recognizedText) uma vez PRA CADA produto do
// catálogo comparado — só que "recognizedText" é sempre o MESMO texto
// dentro dessa busca inteira! Sem cache, isso significava refazer TODO o
// trabalho pesado de novo a cada produto: tirar acento, trocar letra por
// número, e principalmente rodar fixWordLookalikes (que compara cada
// palavra do texto contra a lista inteira de marcas/variantes usando
// Levenshtein) — centenas de vezes seguidas pro EXATO mesmo resultado.
// Isso sozinho já é uma causa e tanto de travamento num catálogo grande.
//
// A solução é simples e não muda o comportamento de ninguém que já chama
// normalizeProductText — só guarda as últimas respostas calculadas e
// devolve na hora se o texto já foi visto. Cache pequeno (16 entradas) e
// com política "usado recentemente fica" (LRU aproximado por reinserção)
// garante que o texto lido (repetido centenas de vezes na mesma busca)
// nunca sai do cache no meio do caminho, mesmo intercalado com dezenas de
// nomes de catálogo diferentes.
const NORMALIZE_TEXT_CACHE_MAX = 16;
const normalizeProductTextCache = new Map();

function normalizeProductText(text) {
  const key = text ?? '';
  if (normalizeProductTextCache.has(key)) {
    const cached = normalizeProductTextCache.get(key);
    // Reinsere pra marcar como "usado recentemente" (aproxima um LRU de
    // verdade usando só a ordem de inserção do Map, sem estrutura extra).
    normalizeProductTextCache.delete(key);
    normalizeProductTextCache.set(key, cached);
    return cached;
  }
  const value = normalizeProductTextUncached(text);
  normalizeProductTextCache.set(key, value);
  if (normalizeProductTextCache.size > NORMALIZE_TEXT_CACHE_MAX) {
    const oldestKey = normalizeProductTextCache.keys().next().value;
    normalizeProductTextCache.delete(oldestKey);
  }
  return value;
}

function extractVariantSet(normalizedUpperText) {
  const found = new Set();
  for (const keyword of VARIANT_KEYWORDS) {
    if (normalizedUpperText.includes(keyword)) found.add(keyword);
  }
  return found;
}

/* ---- PESO POR RARIDADE (idf) — evita casar com o produto ERRADO só ------ */
/* porque palavras GENÉRICAS bateram --------------------------------------- */
//
// PROBLEMA REAL observado: o texto lido "REFRI ZERO COCA COLA 200ML PET..."
// pode bater com "REFRI GUARANÁ ZERO PET 12X200ML" (produto ERRADO) quase tão
// bem quanto com "COCA-COLA ZERO PET 200ML" (produto certo), porque REFRI,
// ZERO e PET aparecem em VÁRIOS produtos do catálogo (refri de qualquer
// marca, zero-açúcar de qualquer marca, embalagem PET de qualquer coisa) —
// só COCA/COLA (ou GUARANÁ) é que realmente diferencia UM produto do outro.
// Se toda palavra vale o mesmo, o casamento pode ganhar por "quantidade de
// palavra comum batendo", ignorando que a palavra que realmente importa
// (a marca) não bateu com o produto errado nenhuma.
//
// Correção: antes de comparar, calcula quantos produtos do catálogo têm cada
// palavra (document frequency). Palavra rara (só em 1-2 produtos, tipo a
// marca) recebe peso ALTO; palavra comum (em quase todo produto, tipo ZERO,
// PET, REFRI, UN) recebe peso BAIXO. Assim, um candidato só ganha pontuação
// alta de verdade quando a(s) palavra(s) DISTINTIVA(S) bate(m), não só as
// genéricas.
function buildTokenDocumentFrequency(rows) {
  const df = new Map();
  for (const row of rows) {
    if (!row.produto) continue;
    const tokens = new Set(normalizeProductText(row.produto).split(' ').filter((t) => t.length > 1));
    for (const token of tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return { df, totalProducts: rows.length || 1 };
}

/** idf suavizado: comum (df alto) → peso perto de baixo; raro (df baixo) → peso alto. */
// FATOR EXTRA DE PRECISÃO — piso de peso pra palavra-variante (ZERO, DIET,
// LIGHT, LATA, GARRAFA...).
//
// Bug relatado: o app confunde "COCA-COLA" com "COCA-COLA ZERO" (e casos
// parecidos: leite integral vs desnatado, cerveja lata vs garrafa...).
// Causa raiz: o peso por raridade (idf) julga "ZERO" pouco importante
// porque ela aparece em MUITOS produtos do catálogo inteiro (refrigerante,
// cerveja, achocolatado...) — mas isso é enganoso: pra DISTINGUIR dois
// produtos IRMÃOS da mesma marca/prateleira (a versão normal e a versão
// zero do MESMO refrigerante), "ZERO" é a ÚNICA palavra que importa. O idf
// olha o catálogo inteiro, não o par específico de candidatos, e por isso
// subestimava essa palavra bem na hora que ela mais importava.
//
// Correção: garante um piso de peso pras palavras-variante — mesmo se o
// cálculo por raridade (idf) achar que ela é comum e desse pouco peso, o
// score final ainda tem que sentir a presença/ausência dela com força.
const VARIANT_TOKEN_WEIGHT_FLOOR = 2.8; // equivalente a uma palavra bem rara no catálogo

function tokenWeight(token, tokenFrequency) {
  if (!tokenFrequency) return 1;
  const { df, totalProducts } = tokenFrequency;
  const occurrences = df.get(token) ?? 1;
  const base = Math.log(1 + totalProducts / occurrences) + 0.3;
  return VARIANT_KEYWORDS.includes(token) ? Math.max(base, VARIANT_TOKEN_WEIGHT_FLOOR) : base;
}

// Quão parecidos dois "tokens" (palavras) precisam ser pra contar como "a
// mesma palavra" mesmo não sendo idênticos — cobre 1-2 letras erradas pela
// OCR (ex.: "ITAL4C" ainda bate com "ITALAC", "DESNATAD0" bate com
// "DESNATADO"). Abaixo desse valor, são tratados como palavras diferentes
// mesmo (evita, por exemplo, casar "LEITE" com "LEVE").
const FUZZY_TOKEN_MATCH_THRESHOLD = 0.72;

/**
 * Sobreposição de palavras "tolerante": em vez de exigir que o token seja
 * IDÊNTICO pra contar como igual, procura o token mais parecido do outro
 * lado (Levenshtein) e aceita como igual se a semelhança passar do piso
 * acima — dando crédito parcial proporcional à semelhança. Isso é o que
 * deixa o casamento resistente a erro de OCR letra-a-letra dentro da
 * própria palavra, sem precisar adivinhar QUAL letra está errada.
 *
 * `tokenFrequency` (opcional, ver buildTokenDocumentFrequency) pesa cada
 * palavra batida pela raridade dela no catálogo — ver comentário acima.
 */
// FATOR EXTRA DE PRECISÃO — bônus por POSIÇÃO: no nome cadastrado no
// catálogo, a primeira palavra costuma ser a MARCA (ex.: "COCA-COLA...",
// "NESTLÉ...", "SKOL..."), que é justamente a palavra mais decisiva pra
// diferenciar produtos parecidos. Multiplica o peso-por-raridade (idf) do
// primeiro token do nome do catálogo, pra bater essa palavra específica
// valer ainda mais do que já valia só pela raridade.
const BRAND_POSITION_BOOST = 1.35;

function tokenOverlapScore(a, b, tokenFrequency) {
  const tokensA = a.split(' ').filter((t) => t.length > 1);
  const tokensB = b.split(' ').filter((t) => t.length > 1);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const weightsB = tokensB.map((tokenB, idx) => {
    const base = tokenWeight(tokenB, tokenFrequency);
    return idx === 0 ? base * BRAND_POSITION_BOOST : base;
  });

  const usedB = new Array(tokensB.length).fill(false);
  let sharedWeight = 0;
  let totalWeightB = 0;
  for (const w of weightsB) totalWeightB += w;

  for (const tokenA of tokensA) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < tokensB.length; i++) {
      if (usedB[i]) continue;
      const sim = similarity(tokenA, tokensB[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1 && bestSim >= FUZZY_TOKEN_MATCH_THRESHOLD) {
      usedB[bestIdx] = true;
      sharedWeight += bestSim * weightsB[bestIdx];
    }
  }

  // IMPORTANTE: divide pelo peso total do nome do CATÁLOGO (tokensB), não
  // pela contagem simples nem pelo maior dos dois textos. O texto "b" aqui é
  // sempre o nome já cadastrado no Baserow (curto e limpo); o texto "a" é o
  // que foi lido (OCR, digitado, ou até uma foto de tela cheia de ruído). Se
  // dividíssemos pelo texto mais longo, um texto lido com bastante ruído em
  // volta (nome do app, ícone de aba, outros textos na foto) fazia o score
  // desabar mesmo quando o nome do produto batia certinho lá dentro. E, sem
  // o peso por raridade, "bater 3 palavras genéricas" contava igual a "bater
  // a palavra que realmente identifica o produto" — ver comentário acima de
  // buildTokenDocumentFrequency.
  return totalWeightB > 0 ? sharedWeight / totalWeightB : 0;
}

/**
 * Similaridade "consciente do produto" entre um texto lido (OCR ou nome
 * digitado) e o nome de um produto já cadastrado no Baserow.
 * `tokenFrequency` (opcional) pesa palavra rara/distintiva mais que palavra
 * genérica do catálogo — ver buildTokenDocumentFrequency.
 * Retorna um score de 0 a 1.
 */
function productTextSimilarity(rawA, rawB, tokenFrequency) {
  const upperA = normalizeProductText(rawA);
  const upperB = normalizeProductText(rawB);
  if (!upperA || !upperB) return 0;

  // FATOR EXTRA: tira do texto LIDO qualquer palavra que pareça ruído de OCR
  // (ver bloco "DETECTOR DE RUÍDO" acima) antes de comparar — assim, se a
  // foto pegou o nome do produto de verdade JUNTO com uma palavra lixo (por
  // causa de risco, textura, reflexo), o lixo não disputa espaço com as
  // palavras reais nem some pontos por "não bater com nada". Nunca aplica
  // isso no nome do catálogo (upperB) — só no que foi lido (upperA).
  const cleanedA = stripGibberishWords(upperA) || upperA;

  const stringScore = similarity(cleanedA, upperB);
  // FATOR EXTRA: bigrama de caractere — ver comentário em bigramJaccardSimilarity.
  // Pega parte do que o Levenshtein "puro" perde quando as palavras vêm fora
  // de ordem na OCR, sem precisar confiar só no overlapScore por token.
  const bigramScore = bigramJaccardSimilarity(cleanedA, upperB);
  // FATOR EXTRA: trigrama de caractere — ver comentário em
  // trigramJaccardSimilarity. Mais rígido que o bigrama, serve de desempate
  // fino entre candidatos próximos sem depender de IA/web nenhuma.
  const trigramScore = trigramJaccardSimilarity(cleanedA, upperB);
  const overlapScore = tokenOverlapScore(cleanedA, upperB, tokenFrequency);
  // overlapScore agora é "recall" (quanto do nome do catálogo foi achado
  // dentro do texto lido — ver comentário em tokenOverlapScore) e por isso é
  // muito mais confiável quando o texto lido tem ruído extra em volta (outras
  // palavras na foto, ou até bagunça de tela). O Levenshtein de string
  // inteira (stringScore) ainda sofre nesse cenário — por isso pesa menos.
  // bigramScore e trigramScore entram com peso pequeno cada, só como
  // "desempate"/reforço extra de detalhamento entre candidatos próximos.
  let score = stringScore * 0.19 + bigramScore * 0.05 + trigramScore * 0.06 + overlapScore * 0.7;

  // ---- ML: sinal "matador" — bate MUITO forte quando é igual, e quase ----
  // ---- elimina quando é diferente -----------------------------------------
  // O volume impresso na embalagem (200ML, 350ML, 1L...) é um número exato,
  // não uma palavra — a OCR quase nunca "inventa" um número que não está lá.
  // Por isso ele é o sinal mais confiável que existe pra confirmar (ou
  // descartar) um candidato, mais até que o nome baterem:
  //   • ML IGUAL → dá um empurrão forte de confiança (ajuda a passar do
  //     limiar mesmo quando o nome veio com bastante ruído/erro de OCR).
  //   • ML DIFERENTE → quase elimina o candidato (dois produtos do mesmo
  //     nome mas tamanho diferente são itens DIFERENTES pra vender, ex.:
  //     Coca-Cola 200ML não é o mesmo item que Coca-Cola 1L).
  const mlA = extractMl(upperA);
  const mlB = extractMl(upperB);
  if (mlA !== null && mlB !== null) {
    if (mlA !== mlB) {
      score *= 0.12;
    } else {
      score = score + (1 - score) * 0.4;
    }
  }

  // ---- PESO (G/KG): mesmo princípio do ML, pra produto vendido por peso ---
  // Cobre o caso que o ML não cobre: arroz, café, carne, farinha, açúcar
  // etc. não têm ML nenhum no rótulo, só peso — sem esse sinal, esses
  // produtos ficavam sem nenhum número "matador" pra confirmar/descartar
  // candidato, dependendo só do nome. Mesma lógica de bônus/penalidade do ML.
  const pesoA = extractWeightGrams(upperA);
  const pesoB = extractWeightGrams(upperB);
  if (pesoA !== null && pesoB !== null) {
    if (pesoA !== pesoB) {
      score *= 0.12;
    } else {
      score = score + (1 - score) * 0.4;
    }
  }

  // ---- QUANTIDADE DE FARDO: mesmo princípio do ML, mais fraco -------------
  // "12X", "X12", "CAIXA COM 12" etc. também é número exato impresso/lido,
  // mas aparece com menos frequência e formato menos padronizado que o ML —
  // por isso o bônus/penalidade aqui é mais discreto que o do ML.
  const quantidadeA = extractPackQuantityFromText(upperA);
  const quantidadeB = extractPackQuantityFromText(upperB);
  if (quantidadeA !== null && quantidadeB !== null) {
    if (quantidadeA !== quantidadeB) {
      score *= 0.5;
    } else {
      score = score + (1 - score) * 0.2;
    }
  }

  // Penalidade por variante diferente (ZERO, LN, GARRAFA, etc): se um dos
  // textos claramente indica uma variante que o outro não tem, o produto
  // provavelmente é diferente mesmo com o nome parecido.
  //
  // Reforçado de 0.55 pra 0.4 (ver comentário grande em VARIANT_TOKEN_WEIGHT_
  // FLOOR, mais acima) — testei o caso relatado (OCR não pegou a palavra
  // "ZERO" na foto) e com 0.55 o score final ficava BEM na borda do piso de
  // aceitação (0.4976 contra piso 0.5) — qualquer ruidozinho a mais na foto
  // já fazia o app confundir o produto normal com o Zero. Com 0.4 (e
  // escalando ainda mais forte se tiver MAIS de uma variante discordando de
  // uma vez, ex.: "ZERO" E "LATA" diferentes ao mesmo tempo), sobra bem mais
  // margem de segurança.
  const variantsA = extractVariantSet(upperA);
  const variantsB = extractVariantSet(upperB);
  const onlyInA = [...variantsA].filter((v) => !variantsB.has(v));
  const onlyInB = [...variantsB].filter((v) => !variantsA.has(v));
  const variantMismatchCount = onlyInA.length + onlyInB.length;
  if (variantMismatchCount > 0) score *= 0.4 ** Math.min(variantMismatchCount, 2);

  return Math.max(0, Math.min(1, score));
}

/**
 * Modo Inteligente por IMAGEM: recebe o texto extraído da foto (OCR local,
 * via expo-text-extractor) e procura, no catálogo já salvo no Baserow, o
 * produto cujo NOME é mais parecido — considerando ML e variante, não só a
 * string crua. Não depende de código de barras nenhum.
 *
 * MELHORIAS DE VELOCIDADE E PRECISÃO:
 *  1. Usa `getTokenFrequency` (cache) em vez de `buildTokenDocumentFrequency`
 *     a cada chamada — elimina O(N) de reconstrução no caminho crítico.
 *  2. Saída antecipada: se encontrar score >= 0.97 (praticamente certeza),
 *     para de comparar o resto do catálogo na hora — economiza iterações.
 *  3. Pré-filtra marcas conhecidas: se o texto lido contiver uma marca do
 *     dicionário, inicia a busca pelos produtos dessa marca (eles ficam no
 *     topo da lista de candidatos) antes de varrer o catálogo todo.
 */
async function findBestMatchByProductText(recognizedText) {
  const rows = await listAllProductsCached();
  // tokenFrequency agora vem do cache — não recalcula a cada scan.
  const tokenFrequency = getTokenFrequency(rows);

  // FATOR EXTRA DE VELOCIDADE — Pré-detecção de marca: se o texto lido
  // contiver uma marca conhecida, coloca os produtos dessa marca na frente da
  // fila de comparação. O resto do catálogo ainda é comparado (pra não perder
  // nada), mas se a marca for forte o produto certo costuma sair logo nos
  // primeiros candidatos → saída antecipada resolve mais rápido.
  const normalizedInput = normalizeProductText(recognizedText);
  const allBrands = [
    ...BRANDS.LEITE, ...BRANDS.CERVEJA, ...BRANDS.REFRIGERANTE, ...BRANDS.AGUA,
  ];
  let detectedBrand = null;
  for (const brand of allBrands.sort((a, b) => b.length - a.length)) {
    if (normalizedInput.includes(brand.replace(/\s+/g, ' '))) { detectedBrand = brand; break; }
  }
  const sortedRows = detectedBrand
    ? [
        ...rows.filter((r) => r.produto && toSearchableUpper(r.produto).includes(detectedBrand)),
        ...rows.filter((r) => r.produto && !toSearchableUpper(r.produto).includes(detectedBrand)),
      ]
    : rows;

  // FATOR EXTRA DE RECONHECIMENTO — "IA" que aprende com erro (ver bloco
  // grande de comentário acima de getMistakePenaltyMap): busca UMA VEZ os
  // erros conhecidos parecidos com esse texto, antes de varrer o catálogo —
  // cada candidato que já foi rejeitado por humano antes, pra um texto
  // parecido com este, entra na disputa em desvantagem.
  const mistakePenalties = await getMistakePenaltyMap(recognizedText);

  let best = null;
  let bestScore = -1;
  const EARLY_EXIT_SCORE = 0.97; // score tão alto que não vale a pena continuar
  for (const row of sortedRows) {
    if (!row.produto) continue;
    let score = productTextSimilarity(recognizedText, row.produto, tokenFrequency);
    const penalty = mistakePenalties.get(String(row.codigo));
    if (penalty !== undefined) score *= penalty;
    if (score > bestScore) {
      bestScore = score;
      best = row;
      if (bestScore >= EARLY_EXIT_SCORE) break; // saída antecipada — praticamente certeza
    }
  }
  if (!best || bestScore < TEXT_SUGGESTION_THRESHOLD) {
    return { found: false, score: bestScore < 0 ? null : bestScore, product: null };
  }
  return { found: true, score: bestScore, product: best };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — 2ª CAMADA: IA CORRETORA DE OCR (Groq)                 */
/*                                                                            */
/* Quando o casamento direto acima (regras + fuzzy) NÃO acha nada com        */
/* confiança, é sinal de que a OCR provavelmente leu o rótulo bagunçado      */
/* demais (sílaba grudada/separada errado, letra trocada por número, palavra */
/* cortada na borda da foto etc). Antes de desistir, a gente manda esse      */
/* texto cru pra uma IA (Groq/Llama) e pede a MELHOR TENTATIVA do nome real  */
/* do produto por trás daquela bagunça — é basicamente "pensar em cima do    */
/* que a OCR encontrou e corrigir", como você pediu. Se a IA falhar por      */
/* qualquer motivo, devolve null e quem chamou ignora essa camada.           */
/* ------------------------------------------------------------------------ */

// Catálogo de nomes reais extraído do banco de dados local — fornecido ao
// modelo como exemplos de referência pra ele reconhecer as marcas corretas.
// Limita a 30 nomes distintos pra não estourar o max_tokens do prompt.
const _ocrCatalogHints = [...new Set(
  LOCAL_PRODUCTS_SNAPSHOT.map((p) => {
    // Extrai só "MARCA TIPO" sem volume/quantidade (ex.: "CERV HEINEKEN LT")
    return p.produto.replace(/\s+\d+[Xx]\d+\s*(ml|l|ML|L)?\s*$/i, '').trim();
  })
)].slice(0, 30).join(', ');

const OCR_FIX_SYSTEM_PROMPT = [
  'Você recebe um texto bagunçado, extraído por OCR de uma foto de rótulo',
  'de produto de supermercado brasileiro. A OCR comete erros típicos: troca',
  'letra por número parecido (O/0, S/5, I/1, B/8), junta duas palavras que',
  'deveriam estar separadas, separa uma palavra no meio por engano, corta',
  'palavra na borda da foto, ou lê símbolo/ruído como se fosse letra.',
  'Sua tarefa: adivinhar o nome REAL do produto (categoria + marca +',
  'variante/sabor/tipo), corrigindo esses erros.',
  '',
  'Produtos que existem neste supermercado (use como referência de nomes reais):',
  _ocrCatalogHints + '.',
  '',
  'Regras:',
  '1. Responda SÓ com o nome corrigido, em maiúsculas, sem aspas, sem',
  '   explicação, sem comentário, sem ponto final.',
  '2. NUNCA inclua volume/peso (L, ML, KG, G) nem quantidade de fardo — não',
  '   é sua tarefa corrigir número, só o nome.',
  '3. Prefira o nome mais próximo da lista de produtos do supermercado acima.',
  '4. Se o texto estiver curto ou confuso demais pra ter certeza de nada,',
  '   responda exatamente NAO_SEI (é melhor admitir do que inventar marca).',
  '5. NUNCA invente marca/sabor que não tenha nenhuma pista no texto',
  '   original — corrija a grafia, não invente produto novo.',
].join('\n');

async function correctOcrTextWithAI(recognizedText) {
  const text = (recognizedText ?? '').trim();
  if (!text) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 40,
        messages: [
          { role: 'system', content: OCR_FIX_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Texto lido pela OCR: "${text}"\n\nResponda só com o nome corrigido, ou NAO_SEI.`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const cleaned = raw.replace(/^["'“”]+|["'“”.]+$/g, '').trim().toUpperCase();
    if (!cleaned || cleaned === 'NAO_SEI' || cleaned.length > 60) return null;

    return cleaned;
  } catch {
    return null; // sem internet, timeout, chave inválida, limite estourado etc.
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — 2ª CAMADA: CONFERÊNCIA EM TEMPO REAL NA WEB (SerpApi)  */
/*                                                                            */
/* Pega o texto lido (ou já corrigido pela IA acima) e faz uma busca de       */
/* verdade no Google via SerpApi — como se você mesmo colasse a descrição    */
/* lá e conferisse o que aparece. Serve pra duas coisas:                     */
/*  1) Se algum resultado trouxer um código de barras (GTIN) na página,      */
/*     esse é o sinal mais forte possível — daí a gente tenta achar esse     */
/*     produto direto no Baserow (e, se quiser evoluir depois, no Cosmos     */
/*     também, exatamente como se tivesse bipado o código de verdade).       */
/*  2) Usa o título dos resultados como candidatos extras de "nome real do   */
/*     produto" pra testar contra o catálogo do Baserow.                     */
/* Se a busca falhar (sem internet, chave inválida, sem resultado), devolve  */
/* null — nunca trava o app nem impede as outras camadas de funcionar.       */
/* ------------------------------------------------------------------------ */

const SERPAPI_URL = 'https://serpapi.com/search.json';
const SERPAPI_TIMEOUT_MS = 8000;

/** Acha o primeiro número de 8, 12, 13 ou 14 dígitos no texto (GTIN típico). */
function extractGtinFromText(text) {
  const match = (text ?? '').match(/\b\d{13}\b|\b\d{14}\b|\b\d{12}\b|\b\d{8}\b/);
  return match ? match[0] : null;
}

async function searchProductOnWeb(query) {
  const q = (query ?? '').trim();
  if (!q || !SERPAPI_API_KEY) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: `${q} código de barras produto supermercado`,
      hl: 'pt-br',
      gl: 'br',
      num: '5',
      api_key: SERPAPI_API_KEY,
    });
    const res = await fetch(`${SERPAPI_URL}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) return null;

    const data = await res.json();
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    if (organic.length === 0) return null;

    const combinedText = organic.map((r) => `${r.title ?? ''} ${r.snippet ?? ''}`).join(' ');
    const gtin = extractGtinFromText(combinedText);

    // Candidato de nome: título do primeiro resultado, cortando o pedaço
    // depois de "-" ou "|" (normalmente é o nome do site/loja, não o produto).
    const rawTitle = organic[0]?.title ?? '';
    const candidateName = rawTitle.split(/[-|]/)[0].trim() || null;

    return {
      candidateName,
      gtin,
      titles: organic.slice(0, 3).map((r) => r.title).filter(Boolean),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — 3ª CAMADA (ÚLTIMO RECURSO): CASAMENTO POR SÍLABA       */
/*                                                                            */
/* O casamento por PALAVRA (tokenOverlapScore, mais acima) já resolve letra  */
/* errada dentro da palavra. O que ele NÃO resolve bem é quando a OCR junta  */
/* ou separa palavras no lugar errado — tipo ler "COCA COLA" como            */
/* "COCACOLA" (uma palavra só) ou "COC ACOLA" (cortada no lugar errado). Em  */
/* nenhum dos dois casos o token bate certinho com "COCA" e "COLA" do        */
/* Baserow. Quebrando em SÍLABAS em vez de em PALAVRAS, o pedaço "COCA" e o  */
/* pedaço "COLA" continuam existindo soltos dentro do texto, não importa    */
/* onde a OCR colocou o espaço — e o casamento continua funcionando.         */
/* Por isso essa camada só entra como ÚLTIMO recurso: sozinha ela é mais     */
/* "solta" que o casamento por palavra (mais chance de falso positivo).      */
/* ------------------------------------------------------------------------ */

const VOWELS_PT = 'AEIOU';

/** Divide uma palavra em sílabas por um critério simples (vogal-consoante). */
function syllabifyWord(word) {
  const w = (word ?? '').toUpperCase();
  const syllables = [];
  let current = '';
  for (let i = 0; i < w.length; i++) {
    current += w[i];
    const thisIsVowel = VOWELS_PT.includes(w[i]);
    const nextIsConsonant = i + 1 < w.length && !VOWELS_PT.includes(w[i + 1]);
    const afterNextIsVowel = i + 2 < w.length && VOWELS_PT.includes(w[i + 2]);
    // Fecha a sílaba num padrão VOGAL + CONSOANTE + VOGAL (a consoante do
    // meio "puxa" pra sílaba seguinte) — corta ANTES da consoante.
    if (thisIsVowel && nextIsConsonant && afterNextIsVowel) {
      syllables.push(current);
      current = '';
    }
  }
  if (current) syllables.push(current);
  return syllables.length ? syllables : [w];
}

/** Sobreposição "tolerante" (igual tokenOverlapScore), mas em SÍLABAS. */
function syllableOverlapScore(a, b) {
  const syllablesA = a.split(' ').filter(Boolean).flatMap(syllabifyWord).filter((s) => s.length >= 2);
  const syllablesB = b.split(' ').filter(Boolean).flatMap(syllabifyWord).filter((s) => s.length >= 2);
  if (syllablesA.length === 0 || syllablesB.length === 0) return 0;

  const usedB = new Array(syllablesB.length).fill(false);
  let sharedWeight = 0;
  for (const sylA of syllablesA) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < syllablesB.length; i++) {
      if (usedB[i]) continue;
      const sim = similarity(sylA, syllablesB[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1 && bestSim >= FUZZY_TOKEN_MATCH_THRESHOLD) {
      usedB[bestIdx] = true;
      sharedWeight += bestSim;
    }
  }
  // Mesmo motivo do tokenOverlapScore acima: divide pelo tamanho do nome do
  // catálogo (b), não pelo maior dos dois — texto lido com ruído extra não
  // pode "diluir" um casamento que na verdade está certo.
  return sharedWeight / syllablesB.length;
}

const SYLLABLE_SUGGESTION_THRESHOLD = 0.55;

function productSyllableSimilarity(rawA, rawB) {
  const upperA = normalizeProductText(rawA);
  const upperB = normalizeProductText(rawB);
  if (!upperA || !upperB) return 0;

  let score = syllableOverlapScore(upperA, upperB);

  // Mesmas penalidades de ML/variante do casamento por palavra — continua
  // não podendo confundir "COCA-COLA" com "COCA-COLA ZERO" só porque as
  // sílabas batem.
  const mlA = extractMl(upperA);
  const mlB = extractMl(upperB);
  if (mlA !== null && mlB !== null && mlA !== mlB) score *= 0.35;

  const variantsA = extractVariantSet(upperA);
  const variantsB = extractVariantSet(upperB);
  const onlyInA = [...variantsA].filter((v) => !variantsB.has(v));
  const onlyInB = [...variantsB].filter((v) => !variantsA.has(v));
  const variantMismatchCount = onlyInA.length + onlyInB.length;
  if (variantMismatchCount > 0) score *= 0.4 ** Math.min(variantMismatchCount, 2);

  return Math.max(0, Math.min(1, score));
}

async function findBestMatchBySyllable(recognizedText) {
  const rows = await listAllProductsCached();
  const mistakePenalties = await getMistakePenaltyMap(recognizedText);
  let best = null;
  let bestScore = -1;
  const EARLY_EXIT_SCORE = 0.97; // mesma ideia do casamento direto — score tão alto que não vale continuar
  for (const row of rows) {
    if (!row.produto) continue;
    let score = productSyllableSimilarity(recognizedText, row.produto);
    const penalty = mistakePenalties.get(String(row.codigo));
    if (penalty !== undefined) score *= penalty;
    if (score > bestScore) {
      bestScore = score;
      best = row;
      if (bestScore >= EARLY_EXIT_SCORE) break;
    }
  }
  if (!best || bestScore < SYLLABLE_SUGGESTION_THRESHOLD) {
    return { found: false, score: bestScore < 0 ? null : bestScore, product: null };
  }
  return { found: true, score: bestScore, product: best };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — ÚLTIMA ALTERNATIVA: "produto com mais letras iguais"   */
/*                                                                            */
/* Pedido específico: quando NADA do resto deu certo (nome não bateu por     */
/* palavra nem por sílaba, IA e busca web também não resolveram), em vez de  */
/* simplesmente devolver "não achei", varre o catálogo inteiro procurando o  */
/* produto cujo nome tem mais LETRAS EM COMUM com o texto que a OCR leu —    */
/* sem olhar ordem, sem separar em palavra nem sílaba, só "quantas letras     */
/* iguais os dois têm". É o método mais simples e mais "bruto" que existe,   */
/* mas é justamente o que ainda funciona quando a foto saiu tão ruim que a   */
/* OCR embaralhou tudo (juntou palavra, inverteu pedaço, faltou letra no meio */
/* etc.) — os métodos anteriores (que dependem de palavra/sílaba reconhecível) */
/* desistem nesse caso, mas ainda sobra letra suficiente em comum pra           */
/* "adivinhar" o produto mais parecido.                                      */
/*                                                                            */
/* Como funciona (Sørensen-Dice sobre o "saco de letras" — bag of chars —    */
/* combinado com bigrama e trigrama, ver rawLetterSimilarity mais abaixo):   */
/*   1. Tira espaço de tudo (junta a palavra inteira numa sequência só de     */
/*      letras/números).                                                    */
/*   2. Conta quantas vezes cada letra aparece nos dois textos (bag of       */
/*      chars) — mas SOZINHO isso é traiçoeiro (todo produto tem A, O, E,    */
/*      R, T, C, L de sobra em português), então soma com bigrama/trigrama   */
/*      (letras em comum GRUDADAS na mesma ordem, não soltas) pra cortar o   */
/*      falso positivo sem perder a tolerância a texto embaralhado.          */
/*   3. Score final: 1.0 quando os textos são praticamente iguais, perto de  */
/*      0 quando não têm nada a ver.                                        */
/* Continua aplicando a penalidade de ML (200ML vs 350ML são produtos         */
/* DIFERENTES mesmo com nome parecidíssimo) — é barata e é o sinal mais       */
/* confiável que existe, então não abre mão dela nem no último recurso.      */
/*                                                                            */
/* Por ser o método mais fraco de todos, o piso de aceitação é baixo         */
/* (RAW_LETTERS_THRESHOLD) — mas o resultado SEMPRE aparece marcado na tela   */
/* como "correspondência aproximada" (ver STAGE_LABELS, stage                */
/* 'letras-parecidas') e ainda passa pelo FILTRO DE QUALIDADE normal          */
/* (hasRequiredScanFields — precisa ter ML + preço + marca reconhecível pra   */
/* travar sozinho); sem isso o app arriscaria "travar" num produto errado só  */
/* por coincidência de letra. Na dúvida, a pessoa confere e corrige na hora.  */
/* ------------------------------------------------------------------------ */

const RAW_LETTERS_THRESHOLD = 0.55;

function bagOfCharsSimilarity(a, b) {
  if (!a.length || !b.length) return 0;

  const freqA = new Map();
  for (const ch of a) freqA.set(ch, (freqA.get(ch) ?? 0) + 1);

  let shared = 0;
  const freqB = new Map();
  for (const ch of b) freqB.set(ch, (freqB.get(ch) ?? 0) + 1);
  for (const [ch, countA] of freqA) {
    const countB = freqB.get(ch) ?? 0;
    shared += Math.min(countA, countB);
  }

  return (2 * shared) / (a.length + b.length);
}

// IMPORTANTE — por que não é só "bag of chars" sozinho: testei e um "saco de
// letras" puro é traiçoeiro (arroz, feijão, café... todo produto tem A, O,
// E, R, T, C, L de sobra — português é cheio de letra repetida), e sozinho
// ele podia até achar "ARROZ TIO JOÃO 5KG" mais parecido com "COCA-COLA
// ZERO" do que o produto certo. Por isso o score final combina bag-of-chars
// com bigrama E trigrama (que já existem no app, ver charBigramSet/
// charTrigramSet mais acima) — esses dois exigem que as letras em comum
// estejam GRUDADAS na mesma ordem (par ou trio), não só soltas em qualquer
// lugar do texto, o que derruba drasticamente o falso positivo mantendo a
// tolerância a OCR embaralhada que era o objetivo desse último recurso.
function rawLetterSimilarity(rawA, rawB) {
  const upperA = normalizeProductText(rawA).replace(/\s+/g, '');
  const upperB = normalizeProductText(rawB).replace(/\s+/g, '');
  if (!upperA || !upperB) return 0;

  const bagScore = bagOfCharsSimilarity(upperA, upperB);
  const biScore = bigramJaccardSimilarity(upperA, upperB);
  const triScore = trigramJaccardSimilarity(upperA, upperB);
  let score = bagScore * 0.35 + biScore * 0.3 + triScore * 0.35;

  // Mesma penalidade "matadora" de ML das outras camadas — barata e é o
  // sinal mais confiável que existe, mesmo no método mais simples de todos.
  const mlA = extractMl(normalizeProductText(rawA));
  const mlB = extractMl(normalizeProductText(rawB));
  if (mlA !== null && mlB !== null && mlA !== mlB) score *= 0.25;

  // Mesma penalidade de variante (ZERO, DIET, LIGHT...) das outras camadas —
  // até no método mais "bruto" de todos não pode confundir "COCA-COLA" com
  // "COCA-COLA ZERO" só porque as letras batem.
  const variantsA = extractVariantSet(normalizeProductText(rawA));
  const variantsB = extractVariantSet(normalizeProductText(rawB));
  const onlyInA = [...variantsA].filter((v) => !variantsB.has(v));
  const onlyInB = [...variantsB].filter((v) => !variantsA.has(v));
  const variantMismatchCount = onlyInA.length + onlyInB.length;
  if (variantMismatchCount > 0) score *= 0.4 ** Math.min(variantMismatchCount, 2);

  return Math.max(0, Math.min(1, score));
}

async function findBestMatchByRawLetters(recognizedText) {
  const rows = await listAllProductsCached();
  const mistakePenalties = await getMistakePenaltyMap(recognizedText);
  let best = null;
  let bestScore = -1;
  const EARLY_EXIT_SCORE = 0.97; // mesma ideia das outras camadas — raro de bater aqui, mas não custa nada
  for (const row of rows) {
    if (!row.produto) continue;
    let score = rawLetterSimilarity(recognizedText, row.produto);
    const penalty = mistakePenalties.get(String(row.codigo));
    if (penalty !== undefined) score *= penalty;
    if (score > bestScore) {
      bestScore = score;
      best = row;
      if (bestScore >= EARLY_EXIT_SCORE) break;
    }
  }
  if (!best || bestScore < RAW_LETTERS_THRESHOLD) {
    return { found: false, score: bestScore < 0 ? null : bestScore, product: null };
  }
  return { found: true, score: bestScore, product: best };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — "CAMADA 0": MEMÓRIA LOCAL DE CONFIRMAÇÕES (aprendizado) */
/*                                                                            */
/* Motivo de existir: a camada de IA/web (Groq + SerpApi, mais abaixo)       */
/* depende de cota e de internet — e cota de API um dia acaba ou falha.      */
/* Esta camada guarda, DENTRO DO PRÓPRIO APARELHO (AsyncStorage, sem         */
/* servidor nenhum), o texto que a OCR leu de cada produto que JÁ foi        */
/* confirmado por um humano (seja tocando em "É este produto" seja           */
/* enviando manualmente na tela de preço) junto com o código do produto      */
/* certo. Da PRÓXIMA vez que a câmera ler um texto parecido (mesma           */
/* prateleira, mesma etiqueta, mesmo jeito de a OCR errar aquele rótulo),    */
/* o app reconhece SOZINHO, sem gastar Groq nem SerpApi — e continua         */
/* funcionando exatamente igual no dia em que a cota do SerpApi acabar de    */
/* vez ou a internet cair no meio da loja. Quanto mais o app é usado, menos  */
/* ele depende de qualquer serviço externo pra reconhecer os produtos que    */
/* já viu antes.                                                            */
/* ------------------------------------------------------------------------ */

const LEARNED_MATCHES_STORAGE_KEY = 'preco-certo:aprendizado-ocr';
const LEARNED_MATCHES_MAX = 500; // teto de segurança pro AsyncStorage não crescer sem limite
// Piso mais EXIGENTE que o do casamento "direto" (0.65) — aqui é memória de
// algo que um humano já confirmou de verdade, então só reaproveita quando a
// semelhança com o texto lido agora é muito forte (evita "aprender errado"
// a colar uma correção antiga em uma foto de produto diferente).
const LEARNED_MATCH_THRESHOLD = 0.8;

let learnedMatchesCache = null; // carregado 1x do AsyncStorage, depois fica em memória

async function loadLearnedMatches() {
  if (learnedMatchesCache) return learnedMatchesCache;
  try {
    const raw = await AsyncStorage.getItem(LEARNED_MATCHES_STORAGE_KEY);
    learnedMatchesCache = raw ? JSON.parse(raw) : [];
  } catch {
    learnedMatchesCache = [];
  }
  return learnedMatchesCache;
}

/**
 * Grava (ou atualiza) uma correspondência confirmada por humano: texto lido
 * pela OCR -> código do produto certo. Chamado na tela de confirmar preço
 * sempre que o usuário efetivamente envia um produto que veio de uma foto do
 * Modo Inteligente — tanto quando a sugestão automática estava certa quanto
 * quando o usuário corrigiu manualmente pra outro produto (nesse segundo
 * caso é ainda mais valioso: é justamente o tipo de erro que o app não deve
 * repetir da próxima vez que ler aquela etiqueta).
 */
async function learnFromConfirmedScan(recognizedText, codigo, produto) {
  const text = (recognizedText ?? '').trim();
  if (!text || !codigo) return; // sem texto lido ou sem código, não tem o que aprender
  const normalized = normalizeProductText(text);
  if (!normalized) return;
  try {
    const list = await loadLearnedMatches();
    // Se já existe uma entrada muito parecida com esse mesmo texto, ATUALIZA
    // em vez de duplicar — evita a lista crescer com quase-repetições da
    // mesma etiqueta fotografada de novo, e corrige na hora se uma correção
    // antiga estava errada.
    const existingIdx = list.findIndex((entry) => similarity(entry.normalized, normalized) >= 0.92);
    const entry = { normalized, codigo: String(codigo), produto: produto ?? null, updatedAt: Date.now() };
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.unshift(entry);
      if (list.length > LEARNED_MATCHES_MAX) list.length = LEARNED_MATCHES_MAX;
    }
    learnedMatchesCache = list;
    await AsyncStorage.setItem(LEARNED_MATCHES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Aprendizado é "bônus" — se falhar (ex.: storage cheio), não deve
    // travar o fluxo de envio do preço, que já terminou com sucesso.
  }
}

/**
 * Procura, na memória local deste aparelho, um texto já confirmado antes
 * que seja MUITO parecido com o texto lido agora. Não usa IA nem internet —
 * só Levenshtein contra o que já foi aprendido, então funciona mesmo sem
 * rede nenhuma.
 */
async function findLearnedMatch(recognizedText) {
  const text = (recognizedText ?? '').trim();
  if (!text) return null;
  const normalized = normalizeProductText(text);
  if (!normalized) return null;
  const list = await loadLearnedMatches();
  let best = null;
  let bestSim = 0;
  for (const entry of list) {
    const sim = similarity(normalized, entry.normalized);
    if (sim > bestSim) {
      bestSim = sim;
      best = entry;
    }
  }
  if (!best || bestSim < LEARNED_MATCH_THRESHOLD) return null;
  const product = await findProductByCodigo(best.codigo);
  if (!product) return null; // produto pode ter sido excluído/renomeado no Baserow depois
  return { product, score: bestSim };
}

/* ------------------------------------------------------------------------ */
/* "IA" QUE APRENDE COM ERRO — memória de tropeço (negativa)                 */
/*                                                                            */
/* A memória acima (learnFromConfirmedScan/findLearnedMatch) é uma memória   */
/* POSITIVA: "esse texto é ESSE produto". Esta aqui é o oposto — uma memória */
/* de ERRO: toda vez que a pessoa aperta "Não é este produto", o app está    */
/* dizendo explicitamente "você errou, não é esse aqui". Isso é sinal        */
/* valioso demais pra jogar fora — sem essa memória, na PRÓXIMA vez que uma  */
/* etiqueta parecida aparecesse, o algoritmo (que não mudou nada) tinha       */
/* boa chance de sugerir o MESMO produto errado de novo.                     */
/*                                                                            */
/* Como funciona: cada erro confirmado fica guardado (texto lido + código do */
/* produto que foi sugerido errado). Da próxima vez que um texto PARECIDO    */
/* aparecer, esse produto específico recebe uma PENALIDADE no score dele —   */
/* não é bloqueado de vez (podia ser coincidência de foto ruim daquela vez), */
/* mas passa a competir em desvantagem contra os outros candidatos. Cada vez */
/* que o MESMO erro se repete pro mesmo tipo de texto, a penalidade fica     */
/* mais forte (contagem por entrada) — o app fica "mais desconfiado" do erro */
/* quanto mais vezes ele se repete, exatamente como alguém aprenderia.       */
/* ------------------------------------------------------------------------ */

const MISTAKE_MEMORY_STORAGE_KEY = 'preco-certo:memoria-de-erros';
const MISTAKE_MEMORY_MAX = 300;
// Piso mais baixo que LEARNED_MATCH_THRESHOLD (0.8) de propósito: pra ERRO,
// vale a pena ser mais abrangente na hora de reconhecer "texto parecido"
// (mesmo que não seja idêntico) — o custo de aplicar uma penalidade extra
// num candidato que JÁ era ruim é baixo, mas o benefício de evitar repetir
// um erro conhecido é alto.
const MISTAKE_MATCH_THRESHOLD = 0.68;

let mistakeMemoryCache = null; // carregado 1x do AsyncStorage, depois fica em memória

async function loadMistakeMemory() {
  if (mistakeMemoryCache) return mistakeMemoryCache;
  try {
    const raw = await AsyncStorage.getItem(MISTAKE_MEMORY_STORAGE_KEY);
    mistakeMemoryCache = raw ? JSON.parse(raw) : [];
  } catch {
    mistakeMemoryCache = [];
  }
  return mistakeMemoryCache;
}

/**
 * Grava um erro confirmado por humano: "pro texto X, o produto Y sugerido
 * estava ERRADO". Chamado quando a pessoa aperta "Não é este produto" numa
 * sugestão do Modo Inteligente.
 */
async function recordMistake(recognizedText, wrongCodigo, wrongProduto) {
  const text = (recognizedText ?? '').trim();
  if (!text || !wrongCodigo) return;
  const normalized = normalizeProductText(text);
  if (!normalized) return;
  try {
    const list = await loadMistakeMemory();
    // Já existe um erro bem parecido registrado pro MESMO produto errado?
    // Soma a contagem (reforça a penalidade) em vez de duplicar a entrada.
    const existingIdx = list.findIndex(
      (entry) => entry.wrongCodigo === String(wrongCodigo) && similarity(entry.normalized, normalized) >= 0.85,
    );
    if (existingIdx >= 0) {
      list[existingIdx] = {
        ...list[existingIdx],
        count: (list[existingIdx].count ?? 1) + 1,
        updatedAt: Date.now(),
      };
    } else {
      list.unshift({
        normalized,
        wrongCodigo: String(wrongCodigo),
        wrongProduto: wrongProduto ?? null,
        count: 1,
        updatedAt: Date.now(),
      });
      if (list.length > MISTAKE_MEMORY_MAX) list.length = MISTAKE_MEMORY_MAX;
    }
    mistakeMemoryCache = list;
    await AsyncStorage.setItem(MISTAKE_MEMORY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Não trava o fluxo de "cadastrar manualmente" se isso falhar — é bônus.
  }
}

/**
 * Monta, PRA UM texto lido específico, um mapa {codigo -> multiplicador de
 * penalidade} com todos os erros conhecidos parecidos o bastante com esse
 * texto. Calculado UMA VEZ por busca (não por produto do catálogo) — o
 * casamento em si só faz uma checagem de mapa (rápida) pra cada candidato,
 * em vez de reconsultar a memória de erro centenas de vezes.
 */
async function getMistakePenaltyMap(recognizedText) {
  const text = (recognizedText ?? '').trim();
  const map = new Map();
  if (!text) return map;
  const normalized = normalizeProductText(text);
  if (!normalized) return map;

  const list = await loadMistakeMemory();
  for (const entry of list) {
    const sim = similarity(normalized, entry.normalized);
    if (sim < MISTAKE_MATCH_THRESHOLD) continue;
    // Penalidade fica mais forte quanto mais parecido o texto E quanto mais
    // vezes esse erro específico já se repetiu — mas nunca some de vez
    // (piso 0.15): pode ser mesmo o produto certo dessa vez, foto diferente.
    const repeatStrength = Math.min(entry.count ?? 1, 5) * 0.08;
    const penalty = Math.max(0.15, 1 - sim * 0.5 - repeatStrength);
    const current = map.get(entry.wrongCodigo);
    if (current === undefined || penalty < current) map.set(entry.wrongCodigo, penalty);
  }
  return map;
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — ORQUESTRADOR: junta as 3 camadas numa função só         */
/*                                                                            */
/* Ordem de tentativa (só avança pra próxima camada se a anterior não achou   */
/* nada com confiança — assim não gasta IA/internet à toa na maioria das     */
/* fotos, que já batem de primeira):                                         */
/*   1. Casamento direto (regras + fuzzy por palavra) — findBestMatchByProductText */
/*   2. IA corretora (Groq) + busca real na web (SerpApi), em paralelo:      */
/*      - se a web achou um código de barras na página, tenta esse código    */
/*        direto no Baserow (igual a ter bipado o código de verdade);        */
/*      - testa cada candidato de nome (original, IA, títulos da web) contra */
/*        o Baserow e fica com o de maior score.                            */
/*   3. Casamento por SÍLABA (original e/ou versão da IA).                   */
/*   4. Última alternativa: produto com mais LETRAS EM COMUM (bag of chars). */
/* Devolve sempre { found, score, product, stage }, onde "stage" diz qual    */
/* camada resolveu — útil pra mostrar na tela como o produto foi achado.     */
/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
/* FATOR EXTRA DE CONFIABILIDADE — isolamento de falha por camada            */
/*                                                                            */
/* Bug relatado: se UMA camada desse errado (uma chamada de rede que falha   */
/* de um jeito inesperado, um texto malformado que quebra alguma conta), o   */
/* erro subia sem tratamento e derrubava a função INTEIRA — nenhuma das      */
/* camadas seguintes chegava a rodar, e o app "parava de funcionar" pra      */
/* aquele scan, mesmo tendo vários outros métodos prontos pra tentar.        */
/*                                                                            */
/* `safeStage` isola cada tentativa: se a função passada der erro por        */
/* qualquer motivo, devolve o valor de reserva (fallback) na hora, em vez de */
/* deixar o erro subir e travar tudo o que viria depois. Isso garante que    */
/* TODAS as camadas (código na foto, aprendizado, direto, IA, web, sílaba,   */
/* letras em comum) sempre têm a chance de rodar, mesmo que uma anterior     */
/* tenha falhado de um jeito que ninguém previu.                            */
/* ------------------------------------------------------------------------ */
async function safeStage(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function enrichRecognizedText(recognizedText) {
  // FATOR EXTRA DE PRECISÃO — código de barras já vem impresso (em dígitos,
  // por baixo das barras) em boa parte das embalagens, e às vezes a OCR
  // pega esses dígitos junto com o nome do produto na mesma foto. Quando
  // isso acontece é o sinal mais forte que existe (13/14/12/8 dígitos batem
  // com o código de barras EXATO cadastrado, não uma aproximação de nome),
  // então testa isso ANTES de qualquer casamento por nome — mais confiável
  // e mais rápido (nem gasta IA/web se já achou por aqui).
  const gtinNaFoto = extractGtinFromText(recognizedText);
  if (gtinNaFoto) {
    const byGtinNaFoto = await safeStage(() => findProductByCodigo(gtinNaFoto), null);
    if (byGtinNaFoto) return { found: true, score: 1, product: byGtinNaFoto, stage: 'codigo-na-foto' };
  }

  // FATOR EXTRA DE RECONHECIMENTO — memória local de confirmações (ver bloco
  // "CAMADA 0" acima). Roda ANTES de qualquer chamada de IA/web: se já vimos
  // (e um humano já confirmou) um texto muito parecido com este antes, usa
  // direto — mais rápido, e não depende do Groq/SerpApi estarem no ar nem
  // terem cota sobrando.
  const learned = await safeStage(() => findLearnedMatch(recognizedText), null);
  if (learned) return { found: true, score: learned.score, product: learned.product, stage: 'aprendido' };

  // FATOR EXTRA DE PRECISÃO — anula de vez a leitura se ela for majoritariamente
  // "ruído" (letras aleatórias sem cara de palavra real, tipo
  // "sdwedfrfdfsdcxa") — ver bloco "DETECTOR DE RUÍDO" acima. Sem código de
  // barras encontrado (checado acima) e sem nenhuma palavra que pareça de
  // verdade, não vale a pena arriscar um casamento por acaso nem gastar
  // IA/busca web à toa — melhor já devolver "não achei" na hora.
  const isNoise = await safeStage(async () => isLikelyNoiseText(recognizedText), false);
  if (isNoise) {
    return { found: false, score: null, product: null, stage: 'ruido' };
  }

  const direct = await safeStage(
    () => findBestMatchByProductText(recognizedText),
    { found: false, score: null, product: null },
  );
  if (direct.found && direct.score >= 0.65) {
    return { ...direct, stage: 'direto' };
  }

  // IA corretora (Groq) e busca web (SerpApi) já devolvem null internamente
  // em caso de falha (ver correctOcrTextWithAI/searchProductOnWeb) — mas o
  // Promise.all em si ainda é protegido aqui, como camada extra de segurança:
  // se qualquer coisa inesperada acontecer nessa dupla chamada, as outras
  // camadas (candidatos diretos, sílaba, letras em comum) continuam rodando
  // do mesmo jeito, só sem o reforço de IA/web dessa vez.
  const [aiGuess, webResult] = await safeStage(
    () => Promise.all([correctOcrTextWithAI(recognizedText), searchProductOnWeb(recognizedText)]),
    [null, null],
  );

  // Sinal mais forte: a web trouxe um código de barras de verdade na página.
  if (webResult?.gtin) {
    const byCodigo = await safeStage(() => findProductByCodigo(webResult.gtin), null);
    if (byCodigo) return { found: true, score: 1, product: byCodigo, stage: 'ean-web' };
  }

  // FATOR EXTRA DE VELOCIDADE / MENOS TRAVAMENTO — cada candidato aqui
  // dispara uma varredura no catálogo INTEIRO (ver findBestMatchByProductText).
  // Duas otimizações que não tiram precisão nenhuma:
  //  1. Limita a quantidade de títulos vindos da busca web — se a página
  //     trouxer 8, 10 títulos parecidos, não faz sentido varrer o catálogo
  //     8-10 vezes a mais só por causa disso; os primeiros já bastam.
  //  2. Remove candidatos com o texto EXATAMENTE igual a outro já na lista
  //     (ex.: a IA às vezes devolve o texto idêntico ao original quando não
  //     via nada pra corrigir) — testar a mesma string 2x dá a mesma
  //     resposta 2x, só custa tempo à toa.
  const MAX_WEB_TITLE_CANDIDATES = 3;
  const rawCandidates = [
    { text: recognizedText, stage: 'direto' },
    { text: aiGuess, stage: 'ia-ocr' },
    { text: webResult?.candidateName, stage: 'busca-web' },
    ...((webResult?.titles ?? []).slice(0, MAX_WEB_TITLE_CANDIDATES).map((t) => ({ text: t, stage: 'busca-web' }))),
  ].filter((c) => c.text);
  const seenCandidateTexts = new Set();
  const candidates = rawCandidates.filter((c) => {
    const key = c.text.trim().toUpperCase();
    if (seenCandidateTexts.has(key)) return false;
    seenCandidateTexts.add(key);
    return true;
  });

  let best = direct.found ? direct : { found: false, score: direct.score, product: null };
  let bestStage = 'direto';
  for (const candidate of candidates) {
    // Cada candidato é testado isoladamente — se UM deles der erro (texto
    // estranho vindo da web, por exemplo), só aquele candidato é descartado;
    // os outros continuam sendo testados normalmente.
    const attempt = await safeStage(
      () => findBestMatchByProductText(candidate.text),
      { found: false, score: null, product: null },
    );
    if (attempt.found && (!best.found || attempt.score > best.score)) {
      best = attempt;
      bestStage = candidate.stage;
    }
  }
  if (best.found) return { ...best, stage: bestStage };

  // Último recurso: casamento por sílaba (texto original e versão da IA).
  const syllableCandidates = [recognizedText, aiGuess].filter(Boolean);
  let bestSyllable = { found: false, score: null, product: null };
  for (const text of syllableCandidates) {
    const attempt = await safeStage(
      () => findBestMatchBySyllable(text),
      { found: false, score: null, product: null },
    );
    if (attempt.found && (!bestSyllable.found || attempt.score > bestSyllable.score)) {
      bestSyllable = attempt;
    }
  }
  if (bestSyllable.found) return { ...bestSyllable, stage: 'silaba' };

  // ÚLTIMA ALTERNATIVA DE VERDADE: nada bateu por palavra nem por sílaba —
  // tenta achar, no catálogo, o produto com mais LETRAS EM COMUM com o texto
  // lido (e, se a IA corrigiu algo, testa a versão dela também). Ver bloco
  // grande de comentário acima de findBestMatchByRawLetters pra entender por
  // que esse método ainda funciona quando os outros desistem.
  const rawLetterCandidates = [recognizedText, aiGuess].filter(Boolean);
  let bestRawLetters = { found: false, score: null, product: null };
  for (const text of rawLetterCandidates) {
    const attempt = await safeStage(
      () => findBestMatchByRawLetters(text),
      { found: false, score: null, product: null },
    );
    if (attempt.found && (!bestRawLetters.found || attempt.score > bestRawLetters.score)) {
      bestRawLetters = attempt;
    }
  }
  if (bestRawLetters.found) return { ...bestRawLetters, stage: 'letras-parecidas' };

  return { found: false, score: direct.score, product: null, stage: 'nenhum' };
}

/* ------------------------------------------------------------------------ */
/* FILTRO DE QUALIDADE — só aceita o resultado se tiver ML + PREÇO + MARCA   */
/*                                                                            */
/* Evita travamento em texto genérico que casou "por coincidência" sem       */
/* informação suficiente pra identificar o produto com segurança.            */
/* Os 3 critérios:                                                           */
/*   • ML   — volume extraído do texto OCR OU registrado no produto          */
/*   • PREÇO — preço lido na etiqueta OU já salvo no sistema                 */
/*   • MARCA — nome do produto contém uma marca conhecida do dicionário      */
/* Só quando os 3 estiverem presentes o app "trava" e exibe o resultado.    */
/* ------------------------------------------------------------------------ */

function hasRequiredScanFields(product, recognizedText) {
  if (!product) return false;

  // 1. ML — no produto cadastrado OU no texto lido pela câmera
  const mlInText = extractMl(normalizeProductText(recognizedText)) !== null;
  const mlInProduct = product.ml !== null && product.ml !== undefined;
  if (!mlInText && !mlInProduct) return false;

  // 2. PREÇO — lido na etiqueta (texto OCR) OU já salvo no Baserow
  const precoInText = extractPriceFromText(recognizedText) !== null;
  const precoInProduct = product.preco !== null && product.preco !== undefined;
  if (!precoInText && !precoInProduct) return false;

  // 3. MARCA — nome do produto contém alguma marca do dicionário
  const nomeProduto = toSearchableUpper(product.produto ?? '');
  const allBrands = [
    ...BRANDS.LEITE, ...BRANDS.CERVEJA, ...BRANDS.REFRIGERANTE, ...BRANDS.AGUA,
  ];
  const hasMarca = allBrands.some((brand) => nomeProduto.includes(brand.replace(/\s+/g, ' ')));
  if (!hasMarca) return false;

  return true;
}

/* ------------------------------------------------------------------------ */
/* CAMADA INTELIGENTE EXTRA — "O QUE FALTOU": auditoria do próprio palpite    */
/*                                                                            */
/* Todas as camadas anteriores (direto, aprendizado, IA, web, sílaba, letras  */
/* em comum) têm um único trabalho: ACHAR um produto. Esta camada faz o       */
/* trabalho OPOSTO — depois que um produto já foi escolhido, ela audita essa  */
/* escolha e aponta, em português direto, quais sinais de confirmação NÃO     */
/* bateram ou simplesmente não foram encontrados (volume, preço, marca,       */
/* variante, método usado). A diferença na prática: em vez do app só dizer    */
/* "achei isso aqui" com uma % de confiança que ninguém sabe explicar, ele     */
/* diz "achei isso, mas não consegui confirmar o preço nem a variante — dá     */
/* uma conferida antes de enviar". Isso mostra ONDE prestar atenção, em vez    */
/* de mandar reconferir a etiqueta inteira de novo. Nunca bloqueia nada       */
/* sozinha (quem trava ou não continua sendo hasRequiredScanFields, acima) —   */
/* aqui é só aviso pra pessoa decidir com mais informação.                    */
/* ------------------------------------------------------------------------ */

function analyzeMissingSignals(product, recognizedText, extra) {
  if (!product) return ['Nenhum produto foi reconhecido com confiança suficiente.'];

  const missing = [];
  const raw = (recognizedText ?? '').trim();
  const normalized = normalizeProductText(raw);
  const nomeProdutoUpper = toSearchableUpper(product.produto ?? '');

  // 1. VOLUME (ML) — mesmo sinal usado no casamento (ver penalidade de ML em
  // productTextSimilarity): se a foto e o cadastro tiverem volumes
  // DIFERENTES, é o indício mais forte que existe de produto trocado.
  const mlNaFoto = extractMl(normalized);
  const mlNoCadastro = product.ml ?? null;
  if (mlNaFoto === null && (mlNoCadastro === null || mlNoCadastro === undefined)) {
    missing.push('Não achei o volume (ML/L) nem na foto nem no cadastro do produto.');
  } else if (
    mlNaFoto !== null
    && mlNoCadastro !== null
    && mlNoCadastro !== undefined
    && mlNaFoto !== mlNoCadastro
  ) {
    missing.push(
      `O volume lido na foto (${formatVolume(mlNaFoto)}) é diferente do cadastrado (${formatVolume(mlNoCadastro)}) — confira se é o produto certo.`,
    );
  }

  // 2. PREÇO — se não veio nem da foto nem do cadastro, a pessoa vai ter que
  // digitar na mão de qualquer jeito — melhor avisar antes do que deixar ela
  // descobrir só na hora de enviar.
  const precoNaFoto = extractPriceFromText(raw);
  if (precoNaFoto === null && (product.preco === null || product.preco === undefined)) {
    missing.push('Não consegui ler o preço na etiqueta — vai precisar digitar na mão.');
  }

  // 3. MARCA — mesma checagem de hasRequiredScanFields, mas aqui é aviso
  // explicativo, não bloqueio.
  const allBrands = [
    ...BRANDS.LEITE, ...BRANDS.CERVEJA, ...BRANDS.REFRIGERANTE, ...BRANDS.AGUA,
  ];
  const hasMarca = allBrands.some((brand) => nomeProdutoUpper.includes(brand.replace(/\s+/g, ' ')));
  if (!hasMarca) {
    missing.push('Não reconheci nenhuma marca conhecida no nome cadastrado desse produto.');
  }

  // 4. VARIANTE (ZERO/DIET/LIGHT/LATA/GARRAFA...) — se a foto e o cadastro
  // discordam em qual variante é (foto tem "ZERO" mas o cadastro é o produto
  // normal, ou o contrário), é risco concreto de confundir produtos irmãos
  // da mesma prateleira.
  const variantesNaFoto = extractVariantSet(normalized);
  const variantesNoCadastro = extractVariantSet(nomeProdutoUpper);
  const soNoCadastro = [...variantesNoCadastro].filter((v) => !variantesNaFoto.has(v));
  const soNaFoto = [...variantesNaFoto].filter((v) => !variantesNoCadastro.has(v));
  if (soNoCadastro.length > 0 || soNaFoto.length > 0) {
    const detalhe = [
      soNoCadastro.length > 0 ? `cadastro tem "${soNoCadastro.join(', ')}"` : null,
      soNaFoto.length > 0 ? `foto tem "${soNaFoto.join(', ')}"` : null,
    ]
      .filter(Boolean)
      .join(' e ');
    missing.push(`A variante pode não bater (${detalhe}) — confira antes de confirmar.`);
  }

  // 5. MÉTODO USADO — se quem resolveu foi uma das camadas "fracas" (sílaba
  // ou letras em comum), deixa claro que foi um palpite aproximado, não um
  // casamento direto de nome/palavra.
  if (extra?.stage === 'silaba' || extra?.stage === 'letras-parecidas') {
    missing.push('O reconhecimento usou um método de última alternativa (aproximado) — vale conferir com atenção redobrada.');
  }

  // 6. MEMÓRIA DE ERRO — "IA" que aprende com erro (ver recordMistake /
  // getMistakePenaltyMap, mais acima). A essa altura o mapa de penalidades
  // já foi carregado em memória durante o próprio casamento (findBestMatch...
  // já chamou getMistakePenaltyMap pra esse mesmo texto), então dá pra ler
  // mistakeMemoryCache aqui direto, sem precisar de "await" nenhum. Se ESSE
  // produto específico já foi apontado como errado antes pra um texto
  // parecido com este, avisa — mesmo que ele ainda tenha vencido a disputa
  // dessa vez (com a penalidade aplicada), vale reforçar a atenção.
  if (mistakeMemoryCache) {
    const codigoAtual = String(product.codigo);
    const jaErrouAntes = mistakeMemoryCache.find(
      (entry) => entry.wrongCodigo === codigoAtual && similarity(entry.normalized, normalized) >= MISTAKE_MATCH_THRESHOLD,
    );
    if (jaErrouAntes) {
      const vezes = jaErrouAntes.count > 1 ? ` (já aconteceu ${jaErrouAntes.count}x)` : '';
      missing.push(`Esse produto já foi apontado como ERRADO antes pra uma leitura parecida${vezes} — confira com atenção redobrada.`);
    }
  }

  return missing;
}

/* ------------------------------------------------------------------------ */
/* IA DE RACIOCÍNIO — explica POR QUE escolheu o produto (Groq/Llama)        */
/*                                                                            */
/* Recebe o texto lido pela OCR, o produto escolhido e até 4 outros          */
/* candidatos que chegaram perto, e pede pra IA explicar os sinais que       */
/* levaram à escolha — marca, volume, variante, preço lido na etiqueta.      */
/* A resposta é devolvida como string simples (não streaming) e o efeito de  */
/* "digitação" é feito pelo componente AIReasoningPanel com setInterval,     */
/* que é a forma mais confiável de simular streaming em React Native.        */
/* Se a chamada falhar, devolve null e o painel simplesmente não aparece.    */
/* ------------------------------------------------------------------------ */

const REASONING_SYSTEM_PROMPT = [
  'Você é o assistente do app "Preço Certo" de um supermercado brasileiro.',
  'Sua tarefa: explicar, de forma MUITO CURTA (2-3 frases diretas, sem introdução),',
  'por que o produto escolhido é a melhor correspondência para o texto que a câmera leu.',
  'Seja específico: cite os sinais concretos que confirmaram a escolha (ML/volume igual,',
  'marca reconhecida, variante batendo, preço lido na etiqueta etc.).',
  'Escreva em português informal, como um assistente rápido de caixa.',
  'NUNCA use "Olá", "Claro", "Com certeza" nem introduções — vá direto ao ponto.',
  'Não repita o nome do produto no começo. Máximo de 60 palavras.',
].join(' ');

async function getAIMatchReasoning(recognizedText, product, nearCandidates) {
  const text = (recognizedText ?? '').trim();
  const nome = product?.produto ?? '';
  if (!text || !nome) return null;

  const candidateList = (nearCandidates ?? [])
    .filter((c) => c.produto && c.produto !== nome)
    .slice(0, 4)
    .map((c) => c.produto)
    .join(', ');

  const userContent = [
    `Texto lido pela câmera: "${text}"`,
    `Produto escolhido: "${nome}"`,
    product?.ml ? `Volume registrado: ${formatVolume(product.ml)}` : '',
    candidateList ? `Outros candidatos descartados: ${candidateList}` : '',
    'Por que este produto foi escolhido?',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.5,
        max_tokens: 100,
        messages: [
          { role: 'system', content: REASONING_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw || raw.length < 10) return null;
    return raw;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------------ */
/* MANUTENÇÃO — limpar todos os preços da planilha de uma vez                */
/* ------------------------------------------------------------------------ */

/**
 * Varre TODAS as linhas do Baserow e limpa (deixa em branco/null) a coluna
 * PREÇO de qualquer linha que tenha preço preenchido. Não mexe em CODIGO,
 * PRODUTO, ML nem QUANTIDADE — só zera o preço, pra recomeçar a contagem
 * de "produtos enviados" do zero.
 * Retorna { total, limpos, falhas } pra exibir um resumo pro usuário.
 */
async function clearAllPrices(onProgress) {
  const rows = await listAllProductsRaw();
  const withPrice = rows.filter((r) => r.preco !== null && r.preco !== undefined);
  let limpos = 0;
  let falhas = 0;
  for (let i = 0; i < withPrice.length; i += 1) {
    const row = withPrice[i];
    try {
      const res = await updateProductRowRemote(row.id, { preco: null });
      if (res) limpos += 1; else falhas += 1;
    } catch {
      falhas += 1;
    }
    if (onProgress) onProgress({ done: i + 1, total: withPrice.length });
  }
  invalidateProductsCache();
  return { total: withPrice.length, limpos, falhas };
}

/* ------------------------------------------------------------------------ */
/* COMPONENTES REUTILIZÁVEIS                                                 */
/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
/* EFEITO TYPEWRITER — "digita" o texto progressivamente                      */
/* ------------------------------------------------------------------------ */

function useTypewriter(text, speed = 22) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    // Reseta sempre que o texto mudar
    setDisplayed('');
    indexRef.current = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!text) return undefined;

    intervalRef.current = setInterval(() => {
      indexRef.current += 1;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(intervalRef.current);
    }, speed);

    return () => clearInterval(intervalRef.current);
  }, [text, speed]);

  const isDone = displayed.length === (text ? text.length : 0);
  return { displayed, isDone };
}

/* ------------------------------------------------------------------------ */
/* PAINEL DE RACIOCÍNIO DA IA — mostra por que o produto foi escolhido        */
/* Aparece no cartão de resultado após o produto ser identificado.           */
/* A IA "pensa" (busca o raciocínio) e depois o texto vai sendo "digitado"   */
/* na tela, token a token, como se estivesse escrevendo ao vivo.             */
/* ------------------------------------------------------------------------ */

function AIReasoningPanel({ product, recognizedText, nearCandidates }) {
  const [reasoning, setReasoning] = useState(null); // null = carregando
  const { displayed, isDone } = useTypewriter(reasoning ?? '', 20);

  useEffect(() => {
    if (!product) return;
    setReasoning(null);
    let cancelled = false;
    getAIMatchReasoning(recognizedText, product, nearCandidates)
      .then((result) => { if (!cancelled) setReasoning(result ?? ''); })
      .catch(() => { if (!cancelled) setReasoning(''); });
    return () => { cancelled = true; };
  }, [product?.id, product?.produto]);

  if (reasoning === '' || reasoning === null && displayed === '') {
    // Enquanto busca — indicador discreto
    return reasoning === null ? (
      <View style={styles.aiReasoningBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ActivityIndicator size="small" color="#8b5cf6" />
          <Text style={styles.aiReasoningLabel}>IA analisando o motivo…</Text>
        </View>
      </View>
    ) : null;
  }

  return (
    <View style={styles.aiReasoningBox}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <Icon name="zap" size={11} color="#8b5cf6" />
        <Text style={styles.aiReasoningLabel}>POR QUE ESCOLHI ESTE PRODUTO</Text>
      </View>
      <Text style={styles.aiReasoningText}>
        {displayed}
        {!isDone ? (
          <Text style={{ color: '#8b5cf6', fontFamily: 'Inter_700Bold' }}>▌</Text>
        ) : null}
      </Text>
    </View>
  );
}

function ScanFrame({ locked, mode, analyzing = false }) {
  const isSmart = mode === 'smart';
  const frameHeight = isSmart ? 240 : 150;
  const frameWidth = isSmart ? 240 : 260;
  const progress = useRef(new Animated.Value(0)).current;
  // "Respiração" — glow pulsando devagar por trás do frame, só no modo
  // Inteligente, pra dar a sensação de "câmera viva, prestando atenção" em
  // vez de um quadrado estático. Para quando trava (achou o produto).
  const breathe = useRef(new Animated.Value(0)).current;
  // Giro do anel pontilhado — só ativa quando `analyzing` (o texto já foi
  // lido e o Modo Inteligente está processando/casando com o catálogo),
  // pra dar feedback visual de "pensando" nesse instante específico.
  const spin = useRef(new Animated.Value(0)).current;
  // "Pulso de acerto" — bounce rápido quando trava com sucesso.
  const lockPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (locked) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [locked, progress]);

  useEffect(() => {
    if (!isSmart || locked) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isSmart, locked, breathe]);

  useEffect(() => {
    if (!analyzing || locked) {
      spin.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [analyzing, locked, spin]);

  useEffect(() => {
    if (!locked) return;
    lockPulse.setValue(1);
    Animated.sequence([
      Animated.spring(lockPulse, { toValue: 1.12, friction: 3, tension: 140, useNativeDriver: true }),
      Animated.spring(lockPulse, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
    ]).start();
  }, [locked, lockPulse]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, frameHeight - 4] });
  const glowScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.4] });
  const spinRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const borderColor = locked ? colors.success : isSmart ? '#8b5cf6' : colors.accent;
  const lineColor = locked ? colors.success : isSmart ? '#06b6d4' : colors.accent;

  return (
    <View style={styles.scanContainer} pointerEvents="none">
      {isSmart && !locked && (
        <LinearGradient colors={['#7c3aed', '#06b6d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.smartBadge}>
          <Icon name="zap" size={11} color="#ffffff" />
          <Text style={styles.smartBadgeText}>{analyzing ? 'IA · entendendo a leitura…' : 'IA · lê a embalagem'}</Text>
        </LinearGradient>
      )}
      <Animated.View style={{ transform: [{ scale: lockPulse }] }}>
        {isSmart && !locked && (
          <Animated.View
            style={[
              styles.frameGlow,
              { width: frameWidth, height: frameHeight, transform: [{ scale: glowScale }], opacity: glowOpacity },
            ]}
          />
        )}
        <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
          <View style={[styles.corner, styles.topLeft, { borderColor }]} />
          <View style={[styles.corner, styles.topRight, { borderColor }]} />
          <View style={[styles.corner, styles.bottomLeft, { borderColor }]} />
          <View style={[styles.corner, styles.bottomRight, { borderColor }]} />
          {isSmart && analyzing && !locked && (
            <Animated.View style={[styles.analyzingRing, { transform: [{ rotate: spinRotate }] }]} />
          )}
          <Animated.View style={[styles.scanLine, { opacity: locked ? 0 : 1, transform: [{ translateY }] }]}>
            <LinearGradient
              colors={['transparent', lineColor, 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {locked && (
            <View style={styles.lockCheckWrap}>
              <Icon name="check" size={26} color="#ffffff" />
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function NumericKeypad({ onKeyPress }) {
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  const handlePress = (key) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onKeyPress(key);
  };
  return (
    <View style={styles.keypadGrid}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          onPress={() => handlePress(key)}
          style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.secondary : colors.card, borderColor: colors.border }]}
        >
          {key === 'del' ? <Icon name="delete" size={22} color={colors.foreground} /> : <Text style={styles.keyLabel}>{key}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

function ProductRow({ product, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <View style={styles.rowIconWrap}>
        <Icon name="tag" size={18} color={colors.primary} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{product.produto || 'Produto sem nome'}</Text>
        <Text style={styles.rowCodigo}>
          {product.codigo}
          {product.quantidade ? `  ·  Cx ${product.quantidade}` : ''}
        </Text>
      </View>
      <View style={styles.rowPricePill}>
        <Text style={styles.rowPrice}>{formatBRL(product.preco)}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ModeButton({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.modeButton}>
      <Text style={[styles.modeButtonText, { color: active ? colors.accentForeground : 'rgba(255,255,255,0.85)' }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* TELA 1 — SCANNER                                                          */
/* ------------------------------------------------------------------------ */

const SCAN_MODE_STORAGE_KEY = 'preco-certo:scan-mode';
// No modo EAN-13 a câmera lê código de barras normalmente e continua com a
// pré-visualização ao vivo (CameraView), sem mudanças.
//
// No modo Inteligente a câmera embutida NÃO é usada pra tirar foto. Em vez
// de ficar tirando fotos sozinha em loop pela pré-visualização (jeito que
// não se mostrou confiável), o app abre a câmera DO SISTEMA (o mesmo app de
// câmera nativo do celular, via expo-image-picker) — a pessoa tira UMA foto
// do rótulo (ou escolhe uma foto já existente na galeria), e só então essa
// foto é processada pelo OCR local (expo-text-extractor). É exatamente o
// padrão do app de exemplo oficial da biblioteca.
const OCR_MIN_TEXT_LENGTH = 3;

const isSmartModeSupported = !!isTextExtractorSupported;

// Texto exibido pra explicar COMO o produto foi encontrado (ver
// enrichRecognizedText). "direto" não mostra nada — foi achado na hora, sem
// precisar de reforço nenhum.
const STAGE_LABELS = {
  direto: null,
  aprendido: 'Reconhecido pela memória do app',
  'codigo-na-foto': 'Código de barras lido na foto',
  'ia-ocr': 'Corrigido por IA',
  'busca-web': 'Confirmado por busca na web',
  'ean-web': 'Código de barras achado na web',
  silaba: 'Casamento por sílaba',
  'letras-parecidas': 'Correspondência aproximada — confira antes de confirmar',
};

/**
 * "VER MAIS" — monta um texto de diagnóstico completo mostrando exatamente
 * o que a OCR leu na foto e quais sinais o Modo Inteligente extraiu dali
 * (ML, peso, quantidade de fardo, preço, código de barras), pra pessoa
 * conseguir conferir se a leitura bateu certo com o rótulo de verdade —
 * como pedido: poder ver tudo que o sistema está lendo, não só o resultado
 * final resumido.
 */
function describeRecognizedText(recognizedText, extra) {
  const raw = (recognizedText ?? '').trim();
  if (!raw) return 'Nenhum texto foi reconhecido nessa leitura.';

  const upper = normalizeProductText(raw);
  const ml = extractMl(upper);
  const peso = extractWeightGrams(upper);
  const quantidade = extractPackQuantityFromText(upper);
  const precoLido = extractPriceFromText(raw);
  const gtin = extractGtinFromText(raw);

  const linhas = [`Texto bruto lido pela câmera:\n"${raw}"`];

  if (isLikelyNoiseText(raw)) {
    linhas.push('⚠️ Esse texto foi identificado como RUÍDO (letras sem cara de palavra real) e a leitura foi anulada automaticamente — nenhum casamento com o catálogo foi tentado.');
  }

  const sinais = [];
  if (gtin) sinais.push(`Código de barras encontrado no texto: ${gtin}`);
  if (ml !== null) sinais.push(`Volume identificado: ${formatVolume(ml)}`);
  if (peso !== null) sinais.push(`Peso identificado: ${peso >= 1000 ? `${(peso / 1000).toFixed(peso % 1000 === 0 ? 0 : 3)}kg` : `${peso}g`}`);
  if (quantidade !== null) sinais.push(`Quantidade de fardo/caixa identificada: ${quantidade} un.`);
  if (precoLido !== null) sinais.push(`Preço identificado na etiqueta: ${formatBRL(precoLido)}`);
  if (sinais.length > 0) linhas.push(`Sinais extraídos:\n${sinais.map((s) => `• ${s}`).join('\n')}`);
  else linhas.push('Nenhum sinal extra (ML, peso, fardo ou preço) foi identificado nesse texto — o casamento usou só o nome.');

  if (extra?.stage && STAGE_LABELS[extra.stage]) {
    linhas.push(`Como o produto foi confirmado: ${STAGE_LABELS[extra.stage]}`);
  }
  if (extra?.score !== null && extra?.score !== undefined) {
    linhas.push(`Confiança do casamento: ${Math.round(Math.max(0, Math.min(1, extra.score)) * 100)}%`);
  }

  // CAMADA INTELIGENTE EXTRA — o que a auditoria acha que faltou (ver
  // analyzeMissingSignals, mais abaixo, logo depois de hasRequiredScanFields).
  if (extra?.productObj) {
    const faltou = analyzeMissingSignals(extra.productObj, raw, extra);
    if (faltou.length > 0) {
      linhas.push(`⚠️ O que pode ter faltado:\n${faltou.map((m) => `• ${m}`).join('\n')}`);
    }
  }

  return linhas.join('\n\n');
}

/**
 * Barra de progresso da CONFIANÇA da leitura (0 a 100%) — usada tanto no
 * modo Inteligente ao vivo (atualiza a cada ciclo de leitura) quanto no
 * cartão de resultado final. Vermelho = baixa confiança, amarelo = média,
 * verde = alta — mesma cor em que a pessoa já reconhece "sinal de trânsito".
 * `dark` controla o tema: `true` (padrão) pra usar sobre a câmera/fundo
 * escuro, `false` pra usar dentro do cartão branco de resultado.
 */
function ConfidenceBar({ score, dark = true }) {
  const hasScore = score !== null && score !== undefined;
  const pct = hasScore ? Math.max(0, Math.min(1, score)) : 0;
  const percentText = Math.round(pct * 100);
  const barColor = pct >= 0.7 ? colors.success : pct >= 0.4 ? colors.accent : '#ef4444';
  const labelColor = dark ? 'rgba(255,255,255,0.75)' : colors.mutedForeground;
  const valueColor = dark ? '#ffffff' : colors.foreground;
  const trackColor = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)';

  // Anima a barra deslizando suavemente até o novo valor em vez de "pular"
  // de largura na hora — reforça a sensação de leitura acontecendo aos
  // poucos (o sistema "formando confiança"), não um número que só troca.
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: percentText,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [percentText, widthAnim]);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: labelColor, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>Confiança da leitura</Text>
        <Text style={{ color: valueColor, fontSize: 11, fontFamily: 'Inter_700Bold' }}>{hasScore ? `${percentText}%` : '—'}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 999, backgroundColor: trackColor, overflow: 'hidden' }}>
        <Animated.View
          style={{
            height: '100%',
            width: widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            borderRadius: 999,
            backgroundColor: barColor,
          }}
        />
      </View>
    </View>
  );
}

/**
 * PAINEL DE LEITURA INTELIGENTE — substitui a pequena "pílula" de status por
 * um painel centralizado, com cara de "sistema entendendo o que vê":
 *   • ícone pulsando (respiração contínua; acelera e muda de cor enquanto
 *     está de fato processando o casamento com o catálogo)
 *   • status com transição suave (crossfade) toda vez que o texto muda, em
 *     vez de trocar seco
 *   • prévia AO VIVO do que a OCR está lendo naquele instante (pisca
 *     suavemente a cada atualização), pra pessoa acompanhar em tempo real
 *     — não só depois de travar num resultado
 *   • barra de confiança (ConfidenceBar, já animada)
 */
function SmartReadingPanel({ status, liveText, score, boxesCount = 0 }) {
  const isAnalyzing = status === 'analyzing';
  const isDetecting = status === 'detecting';

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: isAnalyzing ? 550 : 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: isAnalyzing ? 550 : 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isAnalyzing, pulse]);
  const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const iconOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const iconColor = isAnalyzing ? '#06b6d4' : isDetecting ? colors.success : '#8b5cf6';

  const statusText = isAnalyzing
    ? 'Entendendo o que a câmera está lendo…'
    : isDetecting
      ? `${boxesCount} ${boxesCount === 1 ? 'texto detectado' : 'textos detectados'}`
      : 'Aponte para o rótulo do produto';

  // Crossfade: some e reaparece toda vez que o texto de status muda, em vez
  // de trocar seco — dá a sensação de resposta "pensada", não instantânea.
  const statusOpacity = useRef(new Animated.Value(1)).current;
  const lastStatusRef = useRef(statusText);
  useEffect(() => {
    if (lastStatusRef.current === statusText) return;
    lastStatusRef.current = statusText;
    statusOpacity.setValue(0);
    Animated.timing(statusOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [statusText, statusOpacity]);

  // A prévia ao vivo "pisca" suavemente a cada nova leitura chegando — como
  // um cursor de "estou capturando isso agora".
  const liveOpacity = useRef(new Animated.Value(0)).current;
  const lastLiveRef = useRef('');
  useEffect(() => {
    if (!liveText || lastLiveRef.current === liveText) return;
    lastLiveRef.current = liveText;
    liveOpacity.setValue(0.3);
    Animated.timing(liveOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [liveText, liveOpacity]);

  return (
    <BlurView intensity={36} tint="dark" style={styles.smartPanel}>
      <View style={styles.smartPanelTopRow}>
        <Animated.View
          style={[
            styles.smartPanelIconWrap,
            { backgroundColor: `${iconColor}33`, transform: [{ scale: iconScale }], opacity: iconOpacity },
          ]}
        >
          <Icon name="zap" size={16} color={iconColor} />
        </Animated.View>
        <Animated.Text style={[styles.smartPanelStatus, { opacity: statusOpacity }]} numberOfLines={1}>
          {statusText}
        </Animated.Text>
      </View>

      <Animated.View style={[styles.smartPanelLiveBox, { opacity: liveOpacity }]}>
        <Text style={styles.smartPanelLiveLabel}>O QUE A CÂMERA ESTÁ LENDO</Text>
        <Text style={styles.smartPanelLiveText} numberOfLines={2} ellipsizeMode="tail">
          {liveText || 'Nenhum texto identificado ainda…'}
        </Text>
      </Animated.View>

      <ConfidenceBar score={score} />
    </BlurView>
  );
}

/**
 * Ponto de entrada da tela de escaneamento: escolhe automaticamente entre o
 * Modo Inteligente "tempo real" (LiveTextScanner, se react-native-vision-camera
 * + o plugin de OCR estiverem instalados) ou o modo "loop de foto automática"
 * de sempre (ScannerScreenLegacy) — sem exigir nada manual da pessoa que usa
 * o app, e sem quebrar nada em quem ainda não fez o build com as libs novas.
 */
/** Linha "R$ X,XX/L" — só aparece quando dá pra calcular (tem preço e ml). */
function UnitPriceLine({ preco, ml, style }) {
  const perLiter = computeUnitPricePerLiter(preco, ml);
  if (perLiter === null) return null;
  return <Text style={style}>{formatBRL(perLiter)}/L</Text>;
}

function ScannerScreen(props) {
  if (isVisionCameraSupported) {
    return <LiveTextScanner {...props} />;
  }
  return <ScannerScreenLegacy {...props} />;
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — TEMPO REAL (frame processor, tipo Google Lens)         */
/*                                                                            */
/* Câmera embutida SEMPRE ligada, lendo texto de CADA FRAME direto na thread */
/* da câmera (performOcr, via react-native-vision-camera + ML Kit/Vision     */
/* Framework) — sem tirar foto NENHUMA. O casamento com o Baserow           */
/* (suggestProductByText → enrichRecognizedText, tudo reaproveitado sem      */
/* mudar uma linha) é CARO — chama IA e às vezes a internet — então ele é   */
/* limitado a rodar no máximo 1x a cada LIVE_MATCH_THROTTLE_MS, mesmo a OCR  */
/* rodando a cada frame. O overlay de caixinha em cima do texto (a "cara"    */
/* de Google Lens) é atualizado bem mais rápido (LIVE_BOX_THROTTLE_MS), já   */
/* que só desenhar retângulo é barato.                                       */
/* ------------------------------------------------------------------------ */

// LIVE_MATCH_THROTTLE_MS: intervalo mínimo entre chamadas ao pipeline de OCR
// pesado (IA + Baserow). Reduzido de 850 → 600ms para escaneamento mais
// responsivo. O cache de texto idêntico (lastAnalyzedRef) garante que ciclos
// repetidos com o mesmo texto não disparam busca nova — então baixar esse
// valor não sobrecarrega a rede, só reage mais rápido quando o texto muda.
const LIVE_MATCH_THROTTLE_MS = 600;
// LIVE_BOX_THROTTLE_MS: intervalo mínimo entre atualizações visuais das
// caixinhas "LIDO". Reduzido de 150 → 100ms (~10fps) para animação mais
// suave sem gaguejo perceptível — re-render de retângulos SVG é leve.
const LIVE_BOX_THROTTLE_MS = 100;
// OCR_TARGET_FPS — CORREÇÃO (v7): antes o scanOCR (ML Kit/Vision) rodava em
// TODO frame entregue pela câmera (podendo passar de 30x/segundo), gastando
// CPU à toa e competindo pela thread com o resto do app. Essa era uma das
// causas do "app travado" e da camada de caixinhas (LIDO) sumindo/atrasando.
// 5fps já é mais que suficiente pra leitura de rótulo parado na mão.
const OCR_TARGET_FPS = 20;

/**
 * Caixinhas desenhadas em cima do texto detectado ao vivo — a parte visual
 * "tipo Google Lens". `boxes` vem em coordenadas do FRAME da câmera (que
 * quase nunca bate 1:1 com o tamanho da tela); por isso escalamos pela
 * proporção entre o tamanho do frame e o tamanho da pré-visualização na
 * tela. Isso é o ponto mais sensível a variar de aparelho pra aparelho — se
 * as caixinhas aparecerem meio deslocadas num celular específico, é aqui
 * (scaleX/scaleY) que se ajusta.
 */
/**
 * Um "canto de mira" (estilo scanner de AR/Google Lens) em volta de um
 * trecho de texto detectado — 4 cantos em L, sem preencher o meio, pra não
 * tampar o texto real que a câmera está mostrando. As maiores (mais
 * relevantes) ganham uma etiquetinha "LIDO" flutuando do lado, com uma
 * linha fina ligando ela ao canto da caixa — bem no estilo do mockup.
 */
// React.memo garante que o componente só re-renderiza quando as props mudarem
// de verdade — sem isso, qualquer atualização de estado no pai (ex.: liveStatus)
// força re-render de TODAS as caixinhas mesmo quando as coordenadas não mudaram,
// causando aquele efeito de "tremido" ou "travamento visual".
const LiveTextCorners = React.memo(function LiveTextCorners({ left, top, width, height, showTag }) {
  // Cantos proporcionais ao tamanho da caixa (texto grande = canto maior),
  // com piso e teto pra nunca ficar minúsculo nem exagerado.
  const cornerSize = Math.max(10, Math.min(20, Math.min(width, height) * 0.35));
  const strokeWidth = 2.5;
  const strokeColor = '#22d3ee';

  return (
    <View style={{ position: 'absolute', left, top, width, height }}>
      <View
        style={{
          position: 'absolute', top: 0, left: 0, width: cornerSize, height: cornerSize,
          borderLeftWidth: strokeWidth, borderTopWidth: strokeWidth, borderColor: strokeColor, borderTopLeftRadius: 5,
        }}
      />
      <View
        style={{
          position: 'absolute', top: 0, right: 0, width: cornerSize, height: cornerSize,
          borderRightWidth: strokeWidth, borderTopWidth: strokeWidth, borderColor: strokeColor, borderTopRightRadius: 5,
        }}
      />
      <View
        style={{
          position: 'absolute', bottom: 0, left: 0, width: cornerSize, height: cornerSize,
          borderLeftWidth: strokeWidth, borderBottomWidth: strokeWidth, borderColor: strokeColor, borderBottomLeftRadius: 5,
        }}
      />
      <View
        style={{
          position: 'absolute', bottom: 0, right: 0, width: cornerSize, height: cornerSize,
          borderRightWidth: strokeWidth, borderBottomWidth: strokeWidth, borderColor: strokeColor, borderBottomRightRadius: 5,
        }}
      />
      {showTag && (
        <View style={{ position: 'absolute', top: -8, left: width + 10, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 16, height: 1.5, backgroundColor: strokeColor, opacity: 0.85, marginRight: 5 }} />
          <LinearGradient
            colors={['#7c3aed', '#06b6d4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 3 }}
          >
            <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: '#ffffff' }} />
            <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: '#ffffff', letterSpacing: 0.4 }}>LIDO</Text>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}); // React.memo — fecha o wrapper de memoização

// Quantas caixas no máximo desenhar por ciclo (perf + não poluir a tela) e
// quantas delas (as maiores — geralmente o nome/preço, não letra miúda)
// ganham a etiqueta "LIDO" flutuante.
const MAX_LIVE_BOXES = 10;
const MAX_LIVE_TAGS = 3;
// Caixa cujo lado mais curto for menor que isso (em px do FRAME, não da
// tela) é tratada como ruído — reflexo, poeira, risquinho — e descartada
// antes até de entrar no cálculo de escala.
const MIN_BOX_DIMENSION_PX = 12;

function LiveTextBoxes({ boxes, frameWidth, frameHeight, previewSize }) {
  if (!boxes || boxes.length === 0 || !frameWidth || !frameHeight || !previewSize.width) return null;

  // ── Por que NÃO rotacionamos as coordenadas aqui ──────────────────────────
  //
  // O plugin `vision-camera-ocr-plugin` cria o InputImage do MLKit assim:
  //
  //   InputImage.fromMediaImage(mediaImage, frame.getOrientation())
  //
  // Quando o celular está em retrato e o sensor é paisagem (o caso normal),
  // `getOrientation()` devolve 90°. O MLKit recebe esse ângulo e já retorna
  // as bounding boxes NO ESPAÇO ROTACIONADO (retrato):
  //   box.left  → 0 … frameHeight  (= largura do retrato)
  //   box.top   → 0 … frameWidth   (= altura do retrato)
  //
  // Portanto as coordenadas das caixas JÁ estão no sistema de coordenadas
  // da tela — NÃO precisamos girá-las aqui. Se girássemos, estaríamos
  // aplicando uma segunda rotação por cima da primeira (double-rotation),
  // que é exatamente o bug que fazia as caixinhas aparecer deslocadas.
  //
  // O que SIM precisa ser feito é trocar qual dimensão do frame usar como
  // "largura" e "altura" no cálculo de escala — porque o frame bruto ainda
  // é paisagem (frameWidth > frameHeight), mas as coords das caixas usam a
  // dimensão curta como largura e a longa como altura (o espaço retrato).
  // ─────────────────────────────────────────────────────────────────────────

  const frameIsLandscape = frameWidth > frameHeight;
  const previewIsPortrait = previewSize.height > previewSize.width;
  // needsDimSwap = true: frame é paisagem mas display é retrato (ou vice-versa)
  // → as coords das caixas usam frameHeight como largura e frameWidth como altura
  const needsDimSwap = frameIsLandscape === previewIsPortrait;

  // Dimensões do espaço de coordenadas que o MLKit usou ao gerar as caixas.
  // Com needsDimSwap=true: effectiveW = curto do sensor = largura do retrato,
  //                        effectiveH = longo do sensor  = altura do retrato.
  const effectiveFrameWidth  = needsDimSwap ? frameHeight : frameWidth;
  const effectiveFrameHeight = needsDimSwap ? frameWidth  : frameHeight;

  // Escala "cover": UM fator só (o maior), depois desconta o corte lateral.
  // Usar dois fatores separados (um pra X, outro pra Y) distorce a posição
  // das caixas em aparelhos cujo sensor não tem exatamente a mesma proporção
  // da tela (Xiaomi, Samsung com câmera de sensor 4:3 em tela 20:9, etc.).
  const scale            = Math.max(previewSize.width / effectiveFrameWidth, previewSize.height / effectiveFrameHeight);
  const scaledFrameWidth = effectiveFrameWidth  * scale;
  const scaledFrameHeight= effectiveFrameHeight * scale;
  const cropOffsetX      = (scaledFrameWidth  - previewSize.width)  / 2;
  const cropOffsetY      = (scaledFrameHeight - previewSize.height) / 2;

  // Descarta ruído (caixas minúsculas), ordena da maior pra menor (texto
  // importante costuma ser grande) e limita em MAX_LIVE_BOXES pra não
  // poluir a tela.
  const cleanBoxes = boxes
    .filter((box) => Math.min(box.width, box.height) >= MIN_BOX_DIMENSION_PX)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_LIVE_BOXES);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {cleanBoxes.map((box, index) => {
        // Converte pixel do espaço MLKit → pixel da tela:
        //   pixel_tela = pixel_mlkit * scale − cropOffset
        // (cropOffset desconta a parte da imagem que ficou fora da tela pelo "cover")
        const left   = box.left   * scale - cropOffsetX;
        const top    = box.top    * scale - cropOffsetY;
        const width  = box.width  * scale;
        const height = box.height * scale;

        // Descarta caixas completamente fora da área visível.
        if (left + width < 0 || top + height < 0 ||
            left > previewSize.width || top > previewSize.height) {
          return null;
        }

        return (
          <LiveTextCorners
            key={index}
            left={left} top={top} width={width} height={height}
            showTag={index < MAX_LIVE_TAGS}
          />
        );
      })}
    </View>
  );
}

function LiveTextScanner({ sentCount, onOpenSent, onGoToConfirm, lookupProduct, suggestProductByText }) {
  const insets = useSafeAreaInsets();
  const device = useVCCameraDevice('back');
  const { hasPermission, requestPermission } = useVCCameraPermission();
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [locked, setLocked] = useState(false);
  const [scanMode, setScanMode] = useState('smart');
  const [suggestion, setSuggestion] = useState(null);
  const missingSignals = useMemo(() => {
    if (suggestion?.phase !== 'result') return [];
    return analyzeMissingSignals(suggestion.productObj, suggestion.recognizedText, suggestion);
  }, [suggestion]);
  const [liveStatus, setLiveStatus] = useState(null); // { analyzing: bool, score: number|null }
  const [liveBoxes, setLiveBoxes] = useState({ boxes: [], frameWidth: 0, frameHeight: 0 });
  const [liveRecognizedText, setLiveRecognizedText] = useState('');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const { modal: rawTextModal, show: showRawText } = useAppAlert();
  const lockedRef = useRef(false);
  const lastMatchAtRef = useRef(0);
  const lastBoxUpdateAtRef = useRef(0);
  // CORREÇÃO (v7) — trava contra chamadas sobrepostas: suggestProductByText
  // (IA + busca web + varredura no catálogo) pode levar vários segundos, bem
  // mais que o LIVE_MATCH_THROTTLE_MS (600ms). Sem essa trava, cada frame
  // novo que chegava depois desses 600ms disparava OUTRA chamada pesada em
  // cima da anterior que ainda nem tinha terminado — iam se empilhando várias
  // chamadas de IA/web ao mesmo tempo, engasgando a thread do app inteira
  // (essa era a causa principal do "app travado" e da camada de caixinhas
  // atrasando/sumindo). Mesmo padrão já usado no modo Legacy (smartLoopBusyRef).
  const isMatchingRef = useRef(false);
  // FATOR EXTRA DE VELOCIDADE — mesmo cache usado no ScannerScreenLegacy (ver
  // comentário grande em handleFrameOcrResult, logo abaixo): evita reprocessar
  // o catálogo inteiro quando o frame lido é idêntico ao anterior.
  const lastAnalyzedRef = useRef({ text: null, result: null });
  const indicatorX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(SCAN_MODE_STORAGE_KEY).then((stored) => {
      if (stored === 'ean13' || stored === 'smart') setScanMode(stored);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    Animated.spring(indicatorX, { toValue: scanMode === 'ean13' ? 0 : 1, useNativeDriver: false, damping: 16, stiffness: 180 }).start();
  }, [scanMode, indicatorX]);

  useEffect(() => {
    if (!hasPermission && !permissionAsked) {
      setPermissionAsked(true);
      requestPermission();
    }
  }, [hasPermission, permissionAsked, requestPermission]);

  const indicatorLeft = indicatorX.interpolate({ inputRange: [0, 1], outputRange: ['0%', '50%'] });

  const handleSelectMode = useCallback((mode) => {
    setScanMode(mode);
    setSuggestion(null);
    setLiveStatus(null);
    setLiveBoxes({ boxes: [], frameWidth: 0, frameHeight: 0 });
    setLiveRecognizedText('');
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(SCAN_MODE_STORAGE_KEY, mode).catch(() => {});
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    setSuggestion(null);
    setLiveStatus(null);
    setLiveRecognizedText('');
  }, []);

  const goToConfirm = useCallback((codigo, extra) => {
    onGoToConfirm({ codigo: codigo ?? null, ...extra });
    unlock();
  }, [onGoToConfirm, unlock]);

  const handleManualEntry = useCallback(() => {
    goToConfirm(null);
  }, [goToConfirm]);

  // ---- Modo EAN-13: código de barras nativo do vision-camera (useCodeScanner) ----
  const codeScanner = useVCCodeScanner({
    codeTypes: ['ean-13'],
    onCodeScanned: (codes) => {
      if (scanMode !== 'ean13' || lockedRef.current) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      lockedRef.current = true;
      setLocked(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      goToConfirm(value);
    },
  });

  // ---- Modo Inteligente: chamado (na thread JS) toda vez que a OCR lê algo ----
  // num frame. `boxes` é só pro overlay visual; o casamento de verdade usa
  // `text`. Ver comentário no topo do bloco sobre os dois throttles.
  const handleFrameOcrResult = useCallback((text, boxes, frameWidth, frameHeight) => {
    const now = Date.now();

    if (now - lastBoxUpdateAtRef.current >= LIVE_BOX_THROTTLE_MS) {
      lastBoxUpdateAtRef.current = now;
      setLiveBoxes({ boxes: boxes ?? [], frameWidth, frameHeight });
    }

    if (lockedRef.current) return;
    // O texto que o MLKit devolve (via scanOCR) costuma vir com quebra de
    // linha (\n) entre cada linha lida na etiqueta — troca tudo por espaço
    // aqui, na origem, pra NENHUM lugar do app (cartão de sugestão, busca de
    // preço, casamento com o catálogo) ver texto quebrado em várias linhas.
    // v6: aplica pré-processamento de ruído/reflexo logo na origem do frame
    const trimmed = preProcessOcrRaw(text ?? '');
    if (trimmed.length < OCR_MIN_TEXT_LENGTH) return;

    // Atualiza a prévia AO VIVO no painel — mostra o que a câmera está
    // pegando naquele instante, mesmo antes/sem disparar o casamento com o
    // catálogo (que segue seu próprio throttle, mais espaçado, abaixo).
    setLiveRecognizedText(trimmed);

    if (now - lastMatchAtRef.current < LIVE_MATCH_THROTTLE_MS) return;
    // CORREÇÃO (v7): se já existe uma chamada pesada (IA/web/catálogo) em
    // andamento, NÃO inicia outra em cima — só o throttle de tempo (acima)
    // não bastava, porque suggestProductByText pode demorar bem mais que
    // LIVE_MATCH_THROTTLE_MS. Continua tentando nos próximos frames; assim
    // que a chamada em andamento terminar (ver `finally` abaixo), a próxima
    // tentativa já passa livre.
    if (isMatchingRef.current) return;
    lastMatchAtRef.current = now;
    isMatchingRef.current = true;

    setLiveStatus((prev) => ({ analyzing: true, score: prev?.score ?? null }));
    // FATOR EXTRA DE VELOCIDADE / MENOS TRAVAMENTO — cada frame lido dispara
    // esse handler, e é super comum a câmera ler o MESMO texto em vários
    // frames seguidos (mão parada em cima do rótulo). Sem esse cache, cada
    // um desses frames repetidos disparava uma busca pesada no catálogo
    // inteiro pra chegar sempre na mesma resposta — reaproveitar o resultado
    // quando o texto é idêntico ao do frame anterior corta esse trabalho à
    // toa sem perder precisão nenhuma (é literalmente a mesma pergunta).
    const cachedFrame = lastAnalyzedRef.current;
    const frameResultPromise = cachedFrame.text === trimmed && cachedFrame.result
      ? Promise.resolve(cachedFrame.result)
      : suggestProductByText(trimmed);
    frameResultPromise
      .then((best) => {
        lastAnalyzedRef.current = { text: trimmed, result: best };
        if (lockedRef.current) return;
        setLiveStatus({ analyzing: false, score: best.score ?? null });
        // FILTRO DE QUALIDADE: só trava se encontrar ML + PREÇO + MARCA
        if (best.found && best.produto && hasRequiredScanFields(best, trimmed)) {
          lockedRef.current = true;
          setLocked(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setSuggestion({
            phase: 'result',
            recognizedText: trimmed,
            matchedCodigo: best.codigo ?? null,
            produto: best.produto,
            preco: best.preco ?? null,
            precoDetectado: extractPriceFromText(trimmed),
            ml: best.ml ?? null,
            quantidade: best.quantidade ?? null,
            score: best.score ?? null,
            stage: best.stage ?? null,
            productObj: best,
          });
        }
      })
      .catch(() => {
        setLiveStatus({ analyzing: false, score: null });
      })
      .finally(() => {
        isMatchingRef.current = false;
      });
  }, [suggestProductByText]);

  // CORREÇÃO (v8) — o crash "Frame Processor Error: undefined is not a
  // function" acontecia porque `VisionCamera.runAtTargetFps` é acessado
  // dentro da worklet (thread separada, C++), e o objeto `VisionCamera`
  // inteiro (módulo nativo) não é algo que a worklet consegue enxergar do
  // mesmo jeito que a thread JS normal enxerga — a função vinha como
  // `undefined` lá dentro, mesmo existindo do lado de fora. Removido esse
  // helper por completo. Em vez disso, o throttle de FPS agora usa
  // `Worklets.createSharedValue`, que é a MESMA ponte que o app já usa (ver
  // `Worklets.createRunOnJS` logo abaixo) — essa sim funciona nos dois lados
  // (JS e worklet) porque foi feita exatamente pra isso.
  const ocrLastRunAtSV = useMemo(
    () => (Worklets ? Worklets.createSharedValue(0) : null),
    [],
  );
  const OCR_INTERVAL_MS = 1000 / OCR_TARGET_FPS;

  // `Worklets.createRunOnJS` é a ponte entre a thread da câmera (worklet, C++
  // por baixo) e a thread normal do JS/React — sem ela, dava pra ler o texto
  // mas NUNCA pra atualizar o estado do React ou chamar suggestProductByText.
  const runOcrResultOnJS = useMemo(
    () => (Worklets ? Worklets.createRunOnJS(handleFrameOcrResult) : null),
    [handleFrameOcrResult],
  );

  const frameProcessor = useVCFrameProcessor((frame) => {
    'worklet';

    // CORREÇÃO (v7/v8) — trava de FPS: antes o scanOCR (bem pesado — ML Kit /
    // Apple Vision) rodava em TODO frame entregue pela câmera, sem limite
    // nenhum (o sensor entrega 30 frames por segundo ou mais). Isso deixava
    // a thread da câmera constantemente ocupada, competindo por CPU com o
    // resto do app — a causa raiz tanto do "app travado" quanto da camada
    // de caixinhas (LIDO) sumindo ou demorando pra aparecer, porque as
    // atualizações de estado do React (runOcrResultOnJS) ficavam represadas
    // atrás desse trabalho pesado. Aqui a gente só deixa passar pro scanOCR
    // se já tiver passado tempo suficiente desde a última vez — os frames
    // "de sobra" são pulados sem custo nenhum, a câmera continua fluida.
    if (ocrLastRunAtSV) {
      const nowMs = Date.now();
      if (nowMs - ocrLastRunAtSV.value < OCR_INTERVAL_MS) return;
      ocrLastRunAtSV.value = nowMs;
    }

    // IMPORTANTE: o Frame da câmera só é válido durante este processamento —
    // assim que scanOCR(frame) termina, o plugin pode fechar/invalidar o
    // frame por baixo dos panos. Por isso frame.width/frame.height têm que
    // ser lidos JÁ, antes de mais nada, e guardados em variável comum. Ler
    // eles DEPOIS de chamar scanOCR foi o que causou o erro
    // "Trying to access an already closed Frame".
    const frameWidth = frame.width;
    const frameHeight = frame.height;

    // IMPORTANTE: nada de `?.` (optional chaining) nem `??` (nullish
    // coalescing) aqui dentro. Essas sintaxes fazem o Babel criar variáveis
    // temporárias por baixo dos panos, e quando o worklets-core recompila
    // essa função sozinha (pra rodar isolada na thread da câmera), essa
    // variável temporária pode ficar "órfã" — foi o que causou o crash
    // "Property '_payload$blocks' doesn't exist" na primeira tentativa.
    // Por isso tudo abaixo é escrito com verificação manual (if/ternário),
    // mesmo sendo mais verboso.
    if (!runOcrResultOnJS) return;
    const raw = scanOCR(frame);
    if (!raw) return;

    // Formatos diferentes de plugin de OCR embrulham o resultado de jeitos
    // diferentes ({text, blocks} direto, ou {result: {text, blocks}}).
    const payload = raw.result ? raw.result : raw;
    const text = payload && payload.text ? payload.text : null;
    if (!text) return;

    // Achata blocks → lines → box num array simples de retângulos, só com o
    // que o overlay precisa (left/top/width/height). A caixa delimitadora do
    // MLKit às vezes vem como {left,top,right,bottom} (Android Rect) e às
    // vezes como {left,top,width,height} — calcula o que faltar a partir do
    // que tiver, em vez de assumir um formato só.
    const boxes = [];
    const blocks = payload && payload.blocks ? payload.blocks : [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const lines = block.lines ? block.lines : (block.elements ? block.elements : []);
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const box = line.box ? line.box : (line.boundingBox ? line.boundingBox : line.frame);
        if (box) {
          const left = box.left !== undefined ? box.left : (box.x !== undefined ? box.x : 0);
          const top = box.top !== undefined ? box.top : (box.y !== undefined ? box.y : 0);
          let width = box.width !== undefined ? box.width : 0;
          let height = box.height !== undefined ? box.height : 0;
          if (!width && box.right !== undefined) width = box.right - left;
          if (!height && box.bottom !== undefined) height = box.bottom - top;
          boxes.push({ left: left, top: top, width: width, height: height });
        }
      }
    }

    runOcrResultOnJS(text, boxes, frameWidth, frameHeight);
  }, [runOcrResultOnJS, ocrLastRunAtSV]);

  const handlePreviewLayout = useCallback((event) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  }, []);

  let mainContent = null;
  if (!hasPermission) {
    mainContent = (
      <View style={styles.permissionBox}>
        <LinearGradient colors={[colors.primary, '#0f2f8f']} style={styles.permissionIcon}>
          <Icon name="camera" size={30} color="#ffffff" />
        </LinearGradient>
        <Text style={styles.permissionTitle}>Precisamos da câmera</Text>
        <Text style={styles.permissionText}>Para ler o código de barras e o texto da embalagem em tempo real.</Text>
        <Pressable onPress={requestPermission} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
          <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.permissionButton}>
            <Text style={styles.permissionButtonText}>Permitir câmera</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  } else if (scanMode === 'ean13') {
    mainContent = (
      <View style={styles.overlay}>
        <ScanFrame locked={locked} mode={scanMode} />
        <View style={styles.hintPill}>
          <View style={[styles.hintDot, { backgroundColor: locked ? colors.success : colors.accent }]} />
          <Text style={styles.hint}>{locked ? 'Código lido!' : 'Aponte para o código de barras'}</Text>
        </View>
      </View>
    );
  } else {
    mainContent = (
      <View style={[styles.overlay, styles.smartOverlay]}>
        <ScanFrame locked={locked} mode="smart" analyzing={!!liveStatus?.analyzing} />

        <SmartReadingPanel
          status={liveStatus?.analyzing ? 'analyzing' : liveBoxes.boxes.length > 0 ? 'detecting' : 'idle'}
          liveText={liveRecognizedText}
          score={liveStatus?.score}
          boxesCount={liveBoxes.boxes.length}
        />

        <Pressable onPress={handleManualEntry} style={({ pressed }) => [styles.hintPill, { backgroundColor: 'rgba(0,0,0,0.3)', opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.hint}>Não achou? Cadastrar manualmente</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.foreground }]} onLayout={handlePreviewLayout}>
      {hasPermission && device && (
        <VCCamera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!locked}
          photo={false}
          video={false}
          pixelFormat="yuv"
          frameProcessor={scanMode === 'smart' ? frameProcessor : undefined}
          codeScanner={scanMode === 'ean13' ? codeScanner : undefined}
        />
      )}

      {scanMode === 'smart' && (
        <LiveTextBoxes
          boxes={liveBoxes.boxes}
          frameWidth={liveBoxes.frameWidth}
          frameHeight={liveBoxes.frameHeight}
          previewSize={previewSize}
        />
      )}

      <LinearGradient colors={['rgba(11,20,41,0.92)', 'rgba(11,20,41,0.55)', 'rgba(11,20,41,0)']} style={styles.headerGradient} pointerEvents="box-none">
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerLeft}>
            <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.logoMark}>
              <Icon name="tag" size={14} color={colors.accentForeground} />
            </LinearGradient>
            <View>
              <Text style={styles.headerTitle}>Preço Certo</Text>
              <Text style={styles.headerSubtitle}>Cordeiro Supermercados</Text>
            </View>
          </View>
          <Pressable onPress={onOpenSent} style={({ pressed }) => [styles.headerButton, { transform: [{ scale: pressed ? 0.93 : 1 }] }]}>
            <Icon name="list" size={19} color="#ffffff" />
            {!!sentCount && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{sentCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </LinearGradient>

      {mainContent}

      {suggestion && (
        <View style={styles.suggestionBackdrop}>
          <View style={styles.suggestionCard}>
            <LinearGradient colors={['#7c3aed', '#06b6d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.suggestionTag}>
              <Text style={styles.suggestionTagText}>Modo Inteligente · tempo real</Text>
            </LinearGradient>

            {suggestion.phase === 'notfound' ? (
              <>
                <Text style={styles.suggestionTitle}>
                  {suggestion.stage === 'ruido' ? 'Leitura sem palavras reconhecíveis' : 'Não encontramos esse produto'}
                </Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={1} ellipsizeMode="tail">
                  {suggestion.stage === 'ruido'
                    ? 'Isso não pareceu um nome de produto (parece ruído da câmera) — aponte de novo, bem de perto e com boa luz.'
                    : suggestion.recognizedText
                      ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60).toUpperCase()}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                      : 'Aponte de novo, bem de perto do nome do produto e com boa luz.'}
                </Text>
                {!!suggestion.recognizedText && (
                  <Pressable
                    onPress={() => showRawText(
                      'O que a leitura encontrou',
                      describeRecognizedText(suggestion.recognizedText, suggestion),
                      [{ text: 'Fechar', style: 'cancel' }],
                      { icon: 'list', iconColor: colors.primary },
                    )}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: -4 }}>Ver mais</Text>
                  </Pressable>
                )}
                <View style={styles.suggestionActions}>
                  <Pressable style={[styles.suggestionSecondaryButton, { borderColor: colors.border }]} onPress={() => setSuggestion(null)}>
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Tentar de novo</Text>
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => goToConfirm(null)}>
                    <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.suggestionPrimaryButton}>
                      <Text style={{ color: colors.accentForeground, fontFamily: 'Inter_700Bold' }}>Cadastrar manualmente</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.suggestionTitle}>Produto encontrado pelo texto lido</Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={1} ellipsizeMode="tail">
                  {suggestion.recognizedText
                    ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60).toUpperCase()}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                    : 'Este é o mais parecido no banco de dados:'}
                </Text>
                {!!suggestion.recognizedText && (
                  <Pressable
                    onPress={() => showRawText(
                      'O que a leitura encontrou',
                      describeRecognizedText(suggestion.recognizedText, suggestion),
                      [{ text: 'Fechar', style: 'cancel' }],
                      { icon: 'list', iconColor: colors.primary },
                    )}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: -4 }}>Ver mais</Text>
                  </Pressable>
                )}
                {STAGE_LABELS[suggestion.stage] && (
                  <View style={[styles.suggestionTag, { alignSelf: 'flex-start', backgroundColor: colors.secondary }]}>
                    <Text style={[styles.suggestionTagText, { color: colors.primary }]}>{STAGE_LABELS[suggestion.stage]}</Text>
                  </View>
                )}
                {missingSignals.length > 0 && (
                  <View
                    style={{
                      marginTop: 8,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: 'rgba(245,158,11,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(245,158,11,0.35)',
                      gap: 3,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert-triangle" size={13} color="#d97706" />
                      <Text style={{ color: '#d97706', fontFamily: 'Inter_700Bold', fontSize: 12 }}>Confira antes de confirmar</Text>
                    </View>
                    {missingSignals.slice(0, 2).map((msg) => (
                      <Text key={msg} style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 16 }}>• {msg}</Text>
                    ))}
                  </View>
                )}
                <View style={{ marginTop: 8, marginBottom: 4 }}>
                  <ConfidenceBar score={suggestion.score} dark={false} />
                </View>
                <View style={styles.suggestionProduct}>
                  <Text style={styles.suggestionProductName} numberOfLines={2} ellipsizeMode="tail">{suggestion.produto}</Text>
                  {suggestion.precoDetectado !== null && suggestion.precoDetectado !== undefined ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                        <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.precoDetectado)}</Text>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(16,185,129,0.14)' }}>
                          <Text style={{ fontSize: 10, color: colors.success, fontFamily: 'Inter_700Bold' }}>LIDO NA ETIQUETA</Text>
                        </View>
                      </View>
                      {suggestion.preco !== null && suggestion.preco !== undefined && Math.abs(suggestion.preco - suggestion.precoDetectado) > 0.001 && (
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                          Preço salvo no sistema: {formatBRL(suggestion.preco)} {suggestion.precoDetectado > suggestion.preco ? '↑ subiu' : '↓ baixou'}
                        </Text>
                      )}
                    </>
                  ) : (
                    suggestion.preco !== null && suggestion.preco !== undefined && (
                      <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.preco)}</Text>
                    )
                  )}
                  {(suggestion.ml || suggestion.quantidade) && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {suggestion.ml ? formatVolume(suggestion.ml) : ''}
                      {suggestion.ml && suggestion.quantidade ? '  ·  ' : ''}
                      {suggestion.quantidade ? `Caixa com ${suggestion.quantidade}` : ''}
                    </Text>
                  )}
                  <UnitPriceLine
                    preco={suggestion.precoDetectado !== null && suggestion.precoDetectado !== undefined ? suggestion.precoDetectado : suggestion.preco}
                    ml={suggestion.ml}
                    style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}
                  />
                </View>
                <AIReasoningPanel
                  product={suggestion.productObj}
                  recognizedText={suggestion.recognizedText ?? ''}
                  nearCandidates={[]}
                />
                <View style={styles.suggestionActions}>
                  <Pressable
                    style={[styles.suggestionSecondaryButton, { borderColor: colors.border }]}
                    onPress={() => {
                      // "IA" que aprende com erro — grava que esse produto foi
                      // sugerido errado pra esse texto (ver recordMistake).
                      recordMistake(suggestion.recognizedText, suggestion.matchedCodigo, suggestion.produto).catch(() => {});
                      goToConfirm(null, { precoDetectado: suggestion.precoDetectado, recognizedText: suggestion.recognizedText });
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Não é este</Text>
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => goToConfirm(suggestion.matchedCodigo, { precoDetectado: suggestion.precoDetectado, recognizedText: suggestion.recognizedText })}>
                    <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.suggestionPrimaryButton}>
                      <Text style={{ color: colors.accentForeground, fontFamily: 'Inter_700Bold' }}>É este produto</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      <BlurView intensity={40} tint="dark" style={[styles.modeSwitch, { bottom: insets.bottom + 28 }]}>
        <Animated.View style={[styles.modeIndicator, { left: indicatorLeft }]} />
        <ModeButton label="EAN-13" active={scanMode === 'ean13'} onPress={() => handleSelectMode('ean13')} />
        <ModeButton label="Inteligente" active={scanMode === 'smart'} onPress={() => handleSelectMode('smart')} />
      </BlurView>

      {rawTextModal}
    </View>
  );
}

function ScannerScreenLegacy({ sentCount, onOpenSent, onGoToConfirm, lookupProduct, suggestProductByText }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [scanMode, setScanMode] = useState('smart');
  const [suggestion, setSuggestion] = useState(null);
  const missingSignals = useMemo(() => {
    if (suggestion?.phase !== 'result') return [];
    return analyzeMissingSignals(suggestion.productObj, suggestion.recognizedText, suggestion);
  }, [suggestion]);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [smartPreviewUri, setSmartPreviewUri] = useState(null);
  // ---- Modo Inteligente AO VIVO: estado do "placar" que fica atualizando -
  // enquanto a câmera embutida fica ligada, sem precisar tocar em nada. ----
  const [liveStatus, setLiveStatus] = useState(null); // { analyzing: bool, score: number|null }
  const [liveRecognizedText, setLiveRecognizedText] = useState('');
  const { modal: rawTextModal, show: showRawText } = useAppAlert();
  const cameraRef = useRef(null);
  const smartLoopBusyRef = useRef(false);
  const lockedRef = useRef(false);
  // FATOR EXTRA DE VELOCIDADE — cache do último texto já processado. Ver
  // comentário grande em captureLiveFrame, mais abaixo, sobre por que isso
  // corta bastante processamento repetido (e trava menos) sem perder
  // precisão nenhuma.
  const lastAnalyzedRef = useRef({ text: null, result: null });
  const indicatorX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(SCAN_MODE_STORAGE_KEY).then((stored) => {
      if (stored === 'ean13' || stored === 'smart') setScanMode(stored);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    Animated.spring(indicatorX, { toValue: scanMode === 'ean13' ? 0 : 1, useNativeDriver: false, damping: 16, stiffness: 180 }).start();
  }, [scanMode, indicatorX]);

  const indicatorLeft = indicatorX.interpolate({ inputRange: [0, 1], outputRange: ['0%', '50%'] });

  const handleSelectMode = useCallback((mode) => {
    setScanMode(mode);
    setSuggestion(null);
    setSmartPreviewUri(null);
    setLiveStatus(null);
    setLiveRecognizedText('');
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(SCAN_MODE_STORAGE_KEY, mode).catch(() => {});
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    setSuggestion(null);
    setSmartPreviewUri(null);
    setLiveStatus(null);
    setLiveRecognizedText('');
  }, []);

  const goToConfirm = useCallback((codigo, extra) => {
    onGoToConfirm({ codigo: codigo ?? null, ...extra });
    unlock();
  }, [onGoToConfirm, unlock]);

  // ---- Modo EAN-13: leitura de código de barras normal (sem mudanças) ----
  const handleBarcodeScanned = useCallback(async (result) => {
    if (scanMode !== 'ean13') return;
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    goToConfirm(result.data);
  }, [scanMode, goToConfirm]);

  // ---- Modo Inteligente: FOTO ÚNICA (câmera do sistema ou galeria) + OCR local ----
  // Processa a foto escolhida: lê o texto (OCR local) e casa com o nome do
  // produto já cadastrado no Baserow (ver findBestMatchByProductText).
  const processSmartImage = useCallback(async (uri) => {
    if (!uri) return;
    setSmartPreviewUri(uri);
    setOcrProcessing(true);
    setSuggestion({ phase: 'checking' });
    try {
      const lines = await extractTextFromImage(uri);
      // v6: pré-processamento de ruído/reflexo antes do pipeline de casamento
      const recognizedText = preProcessOcrRaw((lines || []).join(' '));

      if (recognizedText.length < OCR_MIN_TEXT_LENGTH) {
        setSuggestion({ phase: 'notfound', recognizedText: '' });
        return;
      }

      const best = await suggestProductByText(recognizedText);

      // FILTRO DE QUALIDADE: só trava se encontrar ML + PREÇO + MARCA
      if (best.found && best.produto && hasRequiredScanFields(best, recognizedText)) {
        lockedRef.current = true;
        setLocked(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSuggestion({
          phase: 'result',
          recognizedText,
          matchedCodigo: best.codigo ?? null,
          produto: best.produto,
          preco: best.preco ?? null,
          precoDetectado: extractPriceFromText(recognizedText),
          ml: best.ml ?? null,
          quantidade: best.quantidade ?? null,
          score: best.score ?? null,
          stage: best.stage ?? null,
          productObj: best,
        });
      } else {
        setSuggestion({
          phase: 'notfound',
          recognizedText,
          precoDetectado: extractPriceFromText(recognizedText),
          stage: best.stage ?? null,
        });
      }
    } catch {
      setSuggestion({ phase: 'notfound', recognizedText: '' });
    } finally {
      setOcrProcessing(false);
    }
  }, [suggestProductByText]);

  // ---- Modo Inteligente AO VIVO: câmera embutida fica ligada e o app -----
  // fica lendo sozinho, em ciclos curtos, sem precisar tocar em nada. -------
  //
  // Importante ser honesto sobre a técnica aqui: "tempo real" de verdade
  // (analisar TODO frame da câmera, tipo o Google Lens) não dá pra fazer com
  // expo-text-extractor, porque ele só lê TEXTO DE UM ARQUIVO DE IMAGEM já
  // salvo — não tem como ler direto do frame da pré-visualização. O que dá
  // pra fazer (e é o que está aqui) é um loop curto: a cada ~1.3s, tira uma
  // foto BEM leve e silenciosa (sem som de câmera, sem mostrar a prévia —
  // a pessoa continua vendo só a câmera ao vivo por baixo), lê o texto e
  // testa contra o catálogo, e atualiza a barra de confiança na hora. Pra
  // quem está usando, PARECE tempo real (não precisa tocar em nada, a
  // resposta é rápida), mesmo não sendo frame-a-frame de verdade.
  // Reduzido de 1500 → 1150ms a pedido: escaneamento mais rápido. Ainda
  // fica acima de ~1s pra não voltar a sobrecarregar de foto (mais fotos =
  // mais decodificação de JPEG = mais uso de CPU = risco de travamento),
  // mas perceptivelmente mais ágil que antes.
  const SMART_LIVE_INTERVAL_MS = 750;

  const captureLiveFrame = useCallback(async () => {
    if (smartLoopBusyRef.current || lockedRef.current) return;
    if (!cameraRef.current) return;
    smartLoopBusyRef.current = true;
    setLiveStatus((prev) => ({ analyzing: true, score: prev?.score ?? null }));
    try {
      const photo = await cameraRef.current.takePictureAsync({
        // v6: quality elevada de 0.25 → 0.35. O ML Kit consegue ler texto
        // em JPEG baixo, mas artefatos de compressão em qualidade muito
        // baixa (blocos pixelados nas bordas das letras) aumentam a taxa de
        // substituição de letra por dígito — exatamente o problema que os
        // corretores de OCR tentam compensar. 0.35 já evita os piores
        // blocos sem aumentar muito o tamanho do arquivo (~20% maior que
        // 0.25, mas ainda ~2.5× menor que a qualidade padrão do sistema).
        quality: 0.35,
        skipProcessing: true,
        // exif: false reduz o tamanho do arquivo e evita que o ML Kit gaste
        // tempo lendo metadados irrelevantes pra OCR de texto de rótulo.
        exif: false,
      });
      const uri = photo?.uri;
      if (!uri) return;

      const lines = await extractTextFromImage(uri);
      // v6: aplica pré-processamento de ruído/reflexo ANTES de qualquer
      // outra etapa — remove artefatos de brilho (sequências de caracteres
      // repetidos, traços, espaçamentos excessivos) antes que atrapalhem
      // o casamento com o catálogo.
      const recognizedText = preProcessOcrRaw((lines || []).join(' '));
      if (recognizedText.length < OCR_MIN_TEXT_LENGTH) {
        setLiveStatus({ analyzing: false, score: null });
        return;
      }
      setLiveRecognizedText(recognizedText);

      // FATOR EXTRA DE VELOCIDADE / MENOS TRAVAMENTO — se a mão está parada
      // em cima do rótulo (o caso mais comum durante o escaneamento), vários
      // ciclos seguidos leem exatamente o MESMO texto — e sem esse cache o
      // app rodava a busca pesada no catálogo inteiro de novo a cada ~1.15s
      // pra chegar sempre na mesma resposta. Reaproveitar o resultado do
      // ciclo anterior quando o texto é IDÊNTICO corta esse reprocessamento
      // à toa sem abrir mão de precisão nenhuma — é literalmente a mesma
      // pergunta, mesma resposta.
      const cached = lastAnalyzedRef.current;
      const best = cached.text === recognizedText && cached.result
        ? cached.result
        : await suggestProductByText(recognizedText);
      lastAnalyzedRef.current = { text: recognizedText, result: best };
      setLiveStatus({ analyzing: false, score: best.score ?? null });

      // FILTRO DE QUALIDADE: só trava se encontrar ML + PREÇO + MARCA
      if (best.found && best.produto && !lockedRef.current && hasRequiredScanFields(best, recognizedText)) {
        lockedRef.current = true;
        setLocked(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSuggestion({
          phase: 'result',
          recognizedText,
          matchedCodigo: best.codigo ?? null,
          produto: best.produto,
          preco: best.preco ?? null,
          precoDetectado: extractPriceFromText(recognizedText),
          ml: best.ml ?? null,
          quantidade: best.quantidade ?? null,
          score: best.score ?? null,
          stage: best.stage ?? null,
          productObj: best,
        });
      }
    } catch {
      setLiveStatus({ analyzing: false, score: null });
    } finally {
      smartLoopBusyRef.current = false;
    }
  }, [suggestProductByText]);

  // Liga o loop só quando: modo Inteligente ativo, suportado, permissão OK e
  // ainda não travou num resultado. Desliga (limpa o intervalo) em qualquer
  // outra situação — troca de modo, tela fechada, produto já encontrado.
  useEffect(() => {
    if (scanMode !== 'smart' || !isSmartModeSupported || !permission?.granted || locked) {
      return undefined;
    }
    const intervalId = setInterval(captureLiveFrame, SMART_LIVE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [scanMode, permission?.granted, locked, captureLiveFrame]);

  const handleSmartCameraCapture = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!result.canceled) {
        const uri = result.assets?.[0]?.uri;
        await processSmartImage(uri);
      }
    } catch {
      // silencioso — se o picker falhar, a pessoa só tenta de novo
    }
  }, [processSmartImage]);

  const handleSmartGalleryPick = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (!result.canceled) {
        const uri = result.assets?.[0]?.uri;
        await processSmartImage(uri);
      }
    } catch {
      // silencioso — se o picker falhar, a pessoa só tenta de novo
    }
  }, [processSmartImage]);

  const handleManualEntry = useCallback(() => {
    goToConfirm(null);
  }, [goToConfirm]);

  // A câmera embutida agora fica ligada nos DOIS modos: no EAN-13 pra ler
  // código de barras, e no Inteligente pra ficar lendo o texto sozinha em
  // ciclos curtos (ver captureLiveFrame acima). A câmera do sistema
  // (expo-image-picker) continua disponível como atalho manual — o botão
  // "Galeria" e o "Tirar foto" de reforço, caso a leitura automática não
  // pegue por algum motivo (reflexo, letra pequena demais etc.).
  const showLiveCamera = permission?.granted && (scanMode === 'ean13' || isSmartModeSupported);
  const needsPermission = !!permission && !permission.granted;
  const permissionPending = permission === null;

  let mainContent = null;
  if (permissionPending) {
    mainContent = null;
  } else if (needsPermission) {
    mainContent = (
      <View style={styles.permissionBox}>
        <LinearGradient colors={[colors.primary, '#0f2f8f']} style={styles.permissionIcon}>
          <Icon name="camera" size={30} color="#ffffff" />
        </LinearGradient>
        <Text style={styles.permissionTitle}>Precisamos da câmera</Text>
        <Text style={styles.permissionText}>Para ler o código de barras e consultar o preço automaticamente.</Text>
        {permission.canAskAgain !== false ? (
          <Pressable onPress={requestPermission} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
            <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.permissionButton}>
              <Text style={styles.permissionButtonText}>Permitir câmera</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Text style={styles.permissionHint}>Abra as configurações do app e permita o acesso à câmera.</Text>
        )}
      </View>
    );
  } else if (scanMode === 'ean13') {
    mainContent = (
      <View style={styles.overlay}>
        <ScanFrame locked={locked} mode={scanMode} />
        <View style={styles.hintPill}>
          <View style={[styles.hintDot, { backgroundColor: locked ? colors.success : colors.accent }]} />
          <Text style={styles.hint}>{locked ? 'Código lido!' : 'Aponte para o código de barras'}</Text>
        </View>
      </View>
    );
  } else if (!isSmartModeSupported) {
    mainContent = (
      <View style={styles.overlay}>
        <View style={styles.suggestionCard}>
          <Text style={styles.errorTitle}>Modo Inteligente indisponível aqui</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
            A leitura de texto por imagem usa um módulo nativo (ML Kit / Apple Vision) que só funciona num app compilado
            (Dev Client / EAS Build) — não roda dentro do Expo Go nem no simulador do Snack. Use o modo EAN-13 por aqui,
            ou gere um Dev Client pra habilitar a leitura por imagem.
          </Text>
        </View>
      </View>
    );
  } else {
    // Modo Inteligente AO VIVO: a câmera embutida (renderizada mais abaixo)
    // fica visível o tempo todo por baixo deste overlay — sem foto travada
    // na tela, sem precisar tocar em nada. O que muda a cada ciclo é só a
    // barra de confiança e o texto de status.
    mainContent = (
      <View style={[styles.overlay, styles.smartOverlay]}>
        <ScanFrame locked={locked} mode="smart" analyzing={!!liveStatus?.analyzing} />

        <SmartReadingPanel
          status={liveStatus?.analyzing ? 'analyzing' : 'idle'}
          liveText={liveRecognizedText}
          score={liveStatus?.score}
        />

        <View style={styles.smartButtonsRow}>
          <Pressable onPress={handleSmartGalleryPick} style={({ pressed }) => [styles.smartSecondaryButton, { opacity: pressed ? 0.75 : 1 }]}>
            <Icon name="image" size={16} color="#ffffff" />
            <Text style={styles.smartButtonText}>Galeria</Text>
          </Pressable>
          <Pressable onPress={captureLiveFrame} style={({ pressed }) => [{ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
            <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.smartPrimaryButton}>
              <Icon name="camera" size={18} color={colors.accentForeground} />
              <Text style={[styles.smartButtonText, { color: colors.accentForeground }]}>Ler agora</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <Pressable onPress={handleManualEntry} style={({ pressed }) => [styles.hintPill, { backgroundColor: 'rgba(0,0,0,0.3)', opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.hint}>Não achou? Cadastrar manualmente</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.foreground }]}>
      {showLiveCamera && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          {...(scanMode === 'ean13' ? { barcodeScannerSettings: { barcodeTypes: ['ean13'] }, onBarcodeScanned: handleBarcodeScanned } : {})}
        />
      )}

      <LinearGradient colors={['rgba(11,20,41,0.92)', 'rgba(11,20,41,0.55)', 'rgba(11,20,41,0)']} style={styles.headerGradient} pointerEvents="box-none">
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerLeft}>
            <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.logoMark}>
              <Icon name="tag" size={14} color={colors.accentForeground} />
            </LinearGradient>
            <View>
              <Text style={styles.headerTitle}>Preço Certo</Text>
              <Text style={styles.headerSubtitle}>Cordeiro Supermercados</Text>
            </View>
          </View>
          <Pressable onPress={onOpenSent} style={({ pressed }) => [styles.headerButton, { transform: [{ scale: pressed ? 0.93 : 1 }] }]}>
            <Icon name="list" size={19} color="#ffffff" />
            {!!sentCount && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{sentCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </LinearGradient>

      {mainContent}

      {suggestion && (
        <View style={styles.suggestionBackdrop}>
          <View style={styles.suggestionCard}>
            <LinearGradient colors={['#7c3aed', '#06b6d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.suggestionTag}>
              <Text style={styles.suggestionTagText}>Modo Inteligente</Text>
            </LinearGradient>

            {suggestion.phase === 'checking' ? (
              <View style={styles.suggestionChecking}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.suggestionCheckingText}>Procurando produto parecido…</Text>
              </View>
            ) : suggestion.phase === 'notfound' ? (
              <>
                <Text style={styles.suggestionTitle}>
                  {suggestion.stage === 'ruido' ? 'Leitura sem palavras reconhecíveis' : 'Não encontramos esse produto'}
                </Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={1} ellipsizeMode="tail">
                  {suggestion.stage === 'ruido'
                    ? 'Isso não pareceu um nome de produto (parece ruído da câmera) — tente tirar a foto de novo, bem de perto e com boa luz.'
                    : suggestion.recognizedText
                      ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60).toUpperCase()}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                      : 'Tente tirar a foto de novo, bem de perto do nome do produto e com boa luz.'}
                </Text>
                {!!suggestion.recognizedText && (
                  <Pressable
                    onPress={() => showRawText(
                      'O que a leitura encontrou',
                      describeRecognizedText(suggestion.recognizedText, suggestion),
                      [{ text: 'Fechar', style: 'cancel' }],
                      { icon: 'list', iconColor: colors.primary },
                    )}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: -4 }}>Ver mais</Text>
                  </Pressable>
                )}
                {suggestion.precoDetectado !== null && suggestion.precoDetectado !== undefined && (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                    <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.precoDetectado)}</Text>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(16,185,129,0.14)' }}>
                      <Text style={{ fontSize: 10, color: colors.success, fontFamily: 'Inter_700Bold' }}>LIDO NA ETIQUETA</Text>
                    </View>
                  </View>
                )}
                <View style={styles.suggestionActions}>
                  <Pressable style={[styles.suggestionSecondaryButton, { borderColor: colors.border }]} onPress={() => setSuggestion(null)}>
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Tentar de novo</Text>
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => goToConfirm(null, { precoDetectado: suggestion.precoDetectado, recognizedText: suggestion.recognizedText })}>
                    <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.suggestionPrimaryButton}>
                      <Text style={{ color: colors.accentForeground, fontFamily: 'Inter_700Bold' }}>Cadastrar manualmente</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.suggestionTitle}>Produto encontrado pelo texto lido</Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={1} ellipsizeMode="tail">
                  {suggestion.recognizedText
                    ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60).toUpperCase()}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                    : 'Este é o mais parecido no banco de dados:'}
                </Text>
                {!!suggestion.recognizedText && (
                  <Pressable
                    onPress={() => showRawText(
                      'O que a leitura encontrou',
                      describeRecognizedText(suggestion.recognizedText, suggestion),
                      [{ text: 'Fechar', style: 'cancel' }],
                      { icon: 'list', iconColor: colors.primary },
                    )}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: -4 }}>Ver mais</Text>
                  </Pressable>
                )}
                {STAGE_LABELS[suggestion.stage] && (
                  <View style={[styles.suggestionTag, { alignSelf: 'flex-start', backgroundColor: colors.secondary }]}>
                    <Text style={[styles.suggestionTagText, { color: colors.primary }]}>{STAGE_LABELS[suggestion.stage]}</Text>
                  </View>
                )}
                {missingSignals.length > 0 && (
                  <View
                    style={{
                      marginTop: 8,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: 'rgba(245,158,11,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(245,158,11,0.35)',
                      gap: 3,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert-triangle" size={13} color="#d97706" />
                      <Text style={{ color: '#d97706', fontFamily: 'Inter_700Bold', fontSize: 12 }}>Confira antes de confirmar</Text>
                    </View>
                    {missingSignals.slice(0, 2).map((msg) => (
                      <Text key={msg} style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 16 }}>• {msg}</Text>
                    ))}
                  </View>
                )}
                <View style={{ marginTop: 8, marginBottom: 4 }}>
                  <ConfidenceBar score={suggestion.score} dark={false} />
                </View>
                <View style={styles.suggestionProduct}>
                  <Text style={styles.suggestionProductName} numberOfLines={2} ellipsizeMode="tail">{suggestion.produto}</Text>
                  {suggestion.precoDetectado !== null && suggestion.precoDetectado !== undefined ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                        <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.precoDetectado)}</Text>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(16,185,129,0.14)' }}>
                          <Text style={{ fontSize: 10, color: colors.success, fontFamily: 'Inter_700Bold' }}>LIDO NA ETIQUETA</Text>
                        </View>
                      </View>
                      {suggestion.preco !== null && suggestion.preco !== undefined && Math.abs(suggestion.preco - suggestion.precoDetectado) > 0.001 && (
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                          Preço salvo no sistema: {formatBRL(suggestion.preco)} {suggestion.precoDetectado > suggestion.preco ? '↑ subiu' : '↓ baixou'}
                        </Text>
                      )}
                    </>
                  ) : (
                    suggestion.preco !== null && suggestion.preco !== undefined && (
                      <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.preco)}</Text>
                    )
                  )}
                  {(suggestion.ml || suggestion.quantidade) && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {suggestion.ml ? formatVolume(suggestion.ml) : ''}
                      {suggestion.ml && suggestion.quantidade ? '  ·  ' : ''}
                      {suggestion.quantidade ? `Caixa com ${suggestion.quantidade}` : ''}
                    </Text>
                  )}
                  <UnitPriceLine
                    preco={suggestion.precoDetectado !== null && suggestion.precoDetectado !== undefined ? suggestion.precoDetectado : suggestion.preco}
                    ml={suggestion.ml}
                    style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}
                  />
                </View>
                <AIReasoningPanel
                  product={suggestion.productObj}
                  recognizedText={suggestion.recognizedText ?? ''}
                  nearCandidates={[]}
                />
                <View style={styles.suggestionActions}>
                  <Pressable
                    style={[styles.suggestionSecondaryButton, { borderColor: colors.border }]}
                    onPress={() => {
                      // "IA" que aprende com erro — grava que esse produto foi
                      // sugerido errado pra esse texto (ver recordMistake).
                      recordMistake(suggestion.recognizedText, suggestion.matchedCodigo, suggestion.produto).catch(() => {});
                      goToConfirm(null, { precoDetectado: suggestion.precoDetectado, recognizedText: suggestion.recognizedText });
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Não é este</Text>
                  </Pressable>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => goToConfirm(suggestion.matchedCodigo, { precoDetectado: suggestion.precoDetectado, recognizedText: suggestion.recognizedText })}
                  >
                    <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.suggestionPrimaryButton}>
                      <Text style={{ color: colors.accentForeground, fontFamily: 'Inter_700Bold' }}>É este produto</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      <BlurView intensity={40} tint="dark" style={[styles.modeSwitch, { bottom: insets.bottom + 28 }]}>
        <Animated.View style={[styles.modeIndicator, { left: indicatorLeft }]} />
        <ModeButton label="EAN-13" active={scanMode === 'ean13'} onPress={() => handleSelectMode('ean13')} />
        <ModeButton label="Inteligente" active={scanMode === 'smart'} onPress={() => handleSelectMode('smart')} />
      </BlurView>

      {rawTextModal}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* TELA 2 — CONFIRMAR PREÇO                                                  */
/* ------------------------------------------------------------------------ */

function ConfirmScreen({ params, onBack, onDone, lookupProduct, createProduct, updateProduct, deleteProduct }) {
  const insets = useSafeAreaInsets();
  const { codigo } = params; // codigo pode ser null (entrada manual, sem código de barras)
  const isManualEntry = !codigo;

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(!isManualEntry);
  const [isError, setIsError] = useState(false);
  const [produto, setProduto] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [digits, setDigits] = useState('');
  const [codigoInput, setCodigoInput] = useState(codigo ?? '');
  const [mlInput, setMlInput] = useState('');
  const [quantidadeInput, setQuantidadeInput] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const hydratedRef = useRef(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const { modal: alertModal, show: showAlert } = useAppAlert();

  useEffect(() => {
    if (isManualEntry) {
      setData({ id: null, codigo: '', produto: '', preco: null, ml: null, quantidade: null, source: 'manual' });
      setIsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);
    lookupProduct(codigo)
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setIsError(true); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [codigo, isManualEntry]);

  useEffect(() => {
    if (data && !hydratedRef.current) {
      hydratedRef.current = true;
      setProduto(data.produto || '');
      setCodigoInput(data.codigo || codigo || '');
      setMlInput(data.ml !== null && data.ml !== undefined ? String(data.ml) : '');
      setQuantidadeInput(data.quantidade !== null && data.quantidade !== undefined ? String(data.quantidade) : '');
      // Prioriza o preço LIDO AGORA na etiqueta (params.precoDetectado) sobre
      // o preço que já estava salvo no sistema — é justamente pra isso que o
      // Modo Inteligente serve: conferir/atualizar o preço pra bater com o
      // que está impresso na prateleira agora, não repetir o valor antigo.
      const precoParaPreencher =
        params.precoDetectado !== null && params.precoDetectado !== undefined ? params.precoDetectado : data.preco;
      if (precoParaPreencher !== null && precoParaPreencher !== undefined) {
        setDigits(Math.round(precoParaPreencher * 100).toString());
      }
    }
  }, [data, codigo, params.precoDetectado]);

  const handleKeyPress = (key) => {
    if (key === 'del') { setDigits((d) => d.slice(0, -1)); return; }
    if (key === '.') return;
    setDigits((d) => (d.length >= 7 ? d : d + key));
  };

  const canSubmit = produto.trim().length > 0 && digits.length > 0 && !isPending;
  const isEditing = !!data?.id && data?.preco !== null && data?.preco !== undefined;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const preco = centsToAmount(digits);
    const ml = mlInput.trim() === '' ? null : Number(mlInput.replace(',', '.'));
    const quantidade = quantidadeInput.trim() === '' ? null : Number(quantidadeInput.replace(',', '.'));
    // Garante o sufixo "QUANTIDADE x VALOR" (ex.: "6X2L") no nome final,
    // mesmo quando ML/quantidade foram digitados manualmente aqui — vale
    // pra qualquer produto, não só leite/cerveja/água/refrigerante.
    const produtoFinal = appendPackSuffix(produto, ml, quantidade);
    setIsPending(true);
    try {
      if (data?.id) {
        await updateProduct({ id: data.id, data: { produto: produtoFinal, preco, ml, quantidade } });
      } else {
        await createProduct({ codigo: codigoInput.trim(), produto: produtoFinal, preco, ml, quantidade });
      }
      // FATOR EXTRA DE RECONHECIMENTO — aprendizado local (ver bloco "CAMADA 0"
      // / learnFromConfirmedScan). Só faz sentido quando este envio veio de
      // uma foto do Modo Inteligente (params.recognizedText existe) e já se
      // sabe o código certo do produto (codigoInput ou o que já estava
      // salvo). Vale tanto quando a sugestão automática estava certa quanto
      // quando o usuário corrigiu manualmente — os dois casos ensinam o app.
      // Roda em segundo plano (não usa "await" nem trava o "Preço enviado!").
      const codigoAprendido = (codigoInput || '').trim() || data?.codigo || null;
      if (params.recognizedText && codigoAprendido) {
        learnFromConfirmedScan(params.recognizedText, codigoAprendido, produtoFinal).catch(() => {});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSubmitted(true);
      Animated.spring(successScale, { toValue: 1, damping: 12, useNativeDriver: true }).start();
      setTimeout(() => onDone(), 900);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setIsPending(false);
    }
  };

  // Apaga o produto inteiro da planilha (CODIGO, PRODUTO, PREÇO, ML e
  // QUANTIDADE) — só existe pra produto que já está salvo no Baserow
  // (data?.id). Diferente de "Limpar preços", que só zera o preço.
  const handleDeleteProduct = useCallback(() => {
    if (!data?.id || isDeleting) return;
    showAlert(
      'Excluir produto?',
      `Isso vai apagar "${data.produto || produto || 'este produto'}" da planilha inteiro (código, nome, preço, ML e quantidade). Essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteProduct(data.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              onDone();
            } catch {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              showAlert(
                'Erro ao excluir',
                'Não foi possível excluir o produto. Verifique a conexão e tente de novo.',
                [{ text: 'OK', style: 'default' }],
                { icon: 'alert-circle', iconColor: colors.destructive },
              );
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ],
      { icon: 'trash-2', iconColor: colors.destructive },
    );
  }, [data, produto, isDeleting, deleteProduct, onBack, showAlert]);

  if (submitted) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        <Animated.View style={[styles.successCircle, { transform: [{ scale: successScale }] }]}>
          <Icon name="check" size={40} color="#ffffff" />
        </Animated.View>
        <Text style={styles.successText}>Preço enviado!</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Consultando produto…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        <Icon name="wifi-off" size={32} color={colors.destructive} />
        <Text style={styles.errorTitle}>Erro ao consultar</Text>
        <Pressable onPress={onBack} style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground }}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.confirmHeader, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={onBack} style={styles.confirmBackButton}>
          <Icon name="chevron-right" size={18} color={colors.foreground} style={{ transform: [{ rotate: '180deg' }] }} />
        </Pressable>
        <Text style={styles.confirmHeaderTitle}>Confirmar preço</Text>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.infoCard, isEditing && { borderColor: colors.accent, borderWidth: 1.5 }]}>
            <View style={styles.topRow}>
              {isManualEntry ? (
                <View style={[styles.codigoBadge, { flex: 1 }]}>
                  <Icon name="hash" size={13} color={colors.primary} />
                  <TextInput
                    style={[styles.codigoText, { flex: 1, paddingVertical: 0 }]}
                    value={codigoInput}
                    onChangeText={setCodigoInput}
                    placeholder="Código de barras (opcional)"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="number-pad"
                  />
                </View>
              ) : (
                <View style={styles.codigoBadge}>
                  <Icon name="hash" size={13} color={colors.primary} />
                  <Text style={styles.codigoText}>{codigo}</Text>
                </View>
              )}
              {isEditing && (
                <View style={[styles.editBadge, { backgroundColor: colors.accent }]}>
                  <Icon name="edit-2" size={11} color={colors.accentForeground} />
                  <Text style={styles.editBadgeText}>Editando preço</Text>
                </View>
              )}
              {isManualEntry && (
                <LinearGradient colors={['#7c3aed', '#06b6d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.editBadge}>
                  <Icon name="edit-3" size={11} color="#ffffff" />
                  <Text style={[styles.editBadgeText, { color: '#ffffff' }]}>Manual</Text>
                </LinearGradient>
              )}
            </View>

            <View style={styles.nameRow}>
              {editingName ? (
                <TextInput
                  style={styles.nameInput}
                  value={produto}
                  onChangeText={(value) => setProduto(value.toUpperCase())}
                  placeholder="Nome do produto"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  autoFocus
                  onBlur={() => setEditingName(false)}
                  returnKeyType="done"
                />
              ) : (
                <Pressable onPress={() => setEditingName(true)} style={styles.nameDisplay}>
                  <Text style={styles.nameText}>{produto || 'Toque para nomear o produto'}</Text>
                  <Icon name="edit-3" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>

            <View style={styles.metaRow}>
              {editingMeta ? (
                <>
                  <View style={[styles.metaPill, { gap: 6 }]}>
                    <Icon name="droplet" size={12} color={colors.mutedForeground} />
                    <TextInput
                      style={[styles.metaText, { minWidth: 44, paddingVertical: 0 }]}
                      value={mlInput}
                      onChangeText={setMlInput}
                      placeholder="ML"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={[styles.metaPill, { gap: 6 }]}>
                    <Icon name="package" size={12} color={colors.mutedForeground} />
                    <TextInput
                      style={[styles.metaText, { minWidth: 44, paddingVertical: 0 }]}
                      value={quantidadeInput}
                      onChangeText={setQuantidadeInput}
                      placeholder="Qtd/fardo"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                    />
                  </View>
                  <Pressable onPress={() => setEditingMeta(false)} style={styles.metaPill}>
                    <Icon name="check" size={12} color={colors.success} />
                    <Text style={[styles.metaText, { color: colors.success }]}>Pronto</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.metaPill}>
                    <Icon name="droplet" size={12} color={colors.mutedForeground} />
                    <Text style={styles.metaText}>{mlInput ? formatVolume(Number(mlInput)) : 'sem ML'}</Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Icon name="package" size={12} color={colors.mutedForeground} />
                    <Text style={styles.metaText}>{quantidadeInput ? `Caixa com ${quantidadeInput}` : 'sem fardo'}</Text>
                  </View>
                  <Pressable onPress={() => setEditingMeta(true)} style={styles.metaPill}>
                    <Icon name="edit-3" size={12} color={colors.primary} />
                    <Text style={[styles.metaText, { color: colors.primary }]}>Editar</Text>
                  </Pressable>
                </>
              )}
            </View>

            {!!data?.id && (
              <Pressable
                onPress={handleDeleteProduct}
                disabled={isDeleting}
                style={({ pressed }) => [styles.deleteProductRow, { opacity: pressed || isDeleting ? 0.55 : 1 }]}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Icon name="trash-2" size={14} color={colors.destructive} />
                )}
                <Text style={styles.deleteProductRowText}>
                  {isDeleting ? 'Excluindo produto…' : 'Excluir este produto'}
                </Text>
              </Pressable>
            )}
          </View>

          <LinearGradient colors={isEditing ? [colors.accent, '#d97b00'] : [colors.primary, '#0f2f8f']} style={styles.priceCard}>
            {isEditing && data?.preco !== null && data?.preco !== undefined && (
              <View style={styles.previousPriceRow}>
                <Text style={styles.previousPriceLabel}>Preço atual</Text>
                <Text style={styles.previousPriceValue}>{formatCentsBuffer(String(Math.round(data.preco * 100)))}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.priceLabel, isEditing && { color: 'rgba(43,29,0,0.6)' }]}>{isEditing ? 'Novo preço' : 'Preço'}</Text>
              {params.precoDetectado !== null && params.precoDetectado !== undefined && (
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.22)' }}>
                  <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: isEditing ? colors.accentForeground : '#ffffff' }}>
                    LIDO NA ETIQUETA · CONFIRA
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.priceValue, isEditing && { color: colors.accentForeground }]}>{formatCentsBuffer(digits)}</Text>
            <UnitPriceLine
              preco={centsToAmount(digits)}
              ml={mlInput ? Number(mlInput) : null}
              style={{
                color: isEditing ? 'rgba(43,29,0,0.7)' : 'rgba(255,255,255,0.75)',
                fontSize: 12,
                fontFamily: 'Inter_600SemiBold',
                marginTop: 2,
              }}
            />
          </LinearGradient>

          <NumericKeypad onKeyPress={handleKeyPress} />

          <View style={styles.actionsRow}>
            <Pressable onPress={onBack} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, flex: 1, opacity: pressed ? 0.8 : 1 }]}>
              <Icon name="rotate-ccw" size={16} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Rescanear</Text>
            </Pressable>
            <Pressable onPress={handleSubmit} disabled={!canSubmit} style={({ pressed }) => [{ flex: 1.4, transform: [{ scale: pressed && canSubmit ? 0.97 : 1 }] }]}>
              <LinearGradient colors={canSubmit ? [colors.accent, '#ff9d1f'] : [colors.muted, colors.muted]} style={styles.submitButton}>
                {isPending ? (
                  <ActivityIndicator color={colors.accentForeground} />
                ) : (
                  <>
                    <Icon name="send" size={16} color={canSubmit ? colors.accentForeground : colors.mutedForeground} />
                    <Text style={{ color: canSubmit ? colors.accentForeground : colors.mutedForeground, fontFamily: 'Inter_700Bold' }}>Enviar</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {alertModal}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* MODAL DE ALERTA ANIMADO (substitui o Alert.alert nativo)                  */
/* ------------------------------------------------------------------------ */

/**
 * Modal de alerta com animação de fade + escala + leve "bounce", pensado
 * pra substituir o Alert.alert nativo (feio/sem estilo) por algo que segue
 * a identidade visual do app. Suporta título, mensagem, ícone e uma lista
 * de botões com estilos 'default' | 'cancel' | 'destructive'.
 */
function AnimatedAlertButton({ button, onPress }) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const isCancel = button.style === 'cancel';
  const isDestructive = button.style === 'destructive';

  const pressIn = () => Animated.spring(pressScale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  const pressOut = () => Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const backgroundColor = isDestructive ? colors.destructive : isCancel ? colors.muted : colors.primary;
  const textColor = isDestructive ? colors.destructiveForeground : isCancel ? colors.foreground : colors.primaryForeground;

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: pressScale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={[styles.alertButton, { backgroundColor }]}
      >
        <Text style={[styles.alertButtonText, { color: textColor }]}>{button.text}</Text>
      </Pressable>
    </Animated.View>
  );
}

function useAppAlert() {
  const [state, setState] = useState(null); // { title, message, buttons, icon, iconColor }
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const show = useCallback((title, message, buttons, options) => {
    const normalizedButtons = buttons && buttons.length ? buttons : [{ text: 'OK', style: 'default' }];
    setState({
      title,
      message,
      buttons: normalizedButtons,
      icon: (options && options.icon) || 'alert-circle',
      iconColor: (options && options.iconColor) || colors.primary,
    });
  }, []);

  useEffect(() => {
    if (state) {
      opacity.setValue(0);
      scale.setValue(0.85);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dismiss = useCallback((onPress) => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.9, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setState(null);
      if (onPress) onPress();
    });
  }, [backdropOpacity, opacity, scale]);

  const modal = state ? (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={() => dismiss()}>
      <Animated.View style={[styles.alertBackdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} />
        <Animated.View style={[styles.alertCard, { opacity, transform: [{ scale }] }]}>
          <View style={[styles.alertIconWrap, { backgroundColor: `${state.iconColor}1f` }]}>
            <Icon name={state.icon} size={26} color={state.iconColor} />
          </View>
          <Text style={styles.alertTitle}>{state.title}</Text>
          {!!state.message && <Text style={styles.alertMessage}>{state.message}</Text>}
          <View style={styles.alertButtonsRow}>
            {state.buttons.map((button, index) => (
              <AnimatedAlertButton
                key={`${button.text}-${index}`}
                button={button}
                onPress={() => dismiss(button.onPress)}
              />
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  ) : null;

  return { modal, show };
}

/* ------------------------------------------------------------------------ */
/* TELA 3 — PRODUTOS ENVIADOS                                                */
/* ------------------------------------------------------------------------ */

function SentScreen({ onBack, onOpenConfirm, listSentProducts, clearAllPrices }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearProgress, setClearProgress] = useState(null);
  const { modal: alertModal, show: showAlert } = useAppAlert();

  const load = useCallback(() => {
    setIsError(false);
    return listSentProducts()
      .then((result) => setData(result))
      .catch(() => setIsError(true));
  }, [listSentProducts]);

  useEffect(() => { setIsLoading(true); load().finally(() => setIsLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const items = data?.items ?? [];
  const count = data?.count ?? items.length;

  const runClear = useCallback(async () => {
    setClearing(true);
    setClearProgress({ done: 0, total: count });
    try {
      const result = await clearAllPrices((p) => setClearProgress(p));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await load();
      showAlert(
        'Preços limpos',
        `${result.limpos} de ${result.total} preço(s) apagado(s)${result.falhas ? ` — ${result.falhas} falharam.` : '.'}`,
        [{ text: 'OK', style: 'default' }],
        { icon: 'check-circle', iconColor: colors.success },
      );
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      showAlert(
        'Erro',
        'Não foi possível limpar os preços. Verifique a conexão e tente de novo.',
        [{ text: 'OK', style: 'default' }],
        { icon: 'alert-circle', iconColor: colors.destructive },
      );
    } finally {
      setClearing(false);
      setClearProgress(null);
    }
  }, [clearAllPrices, count, load]);

  const confirmClear = useCallback(() => {
    if (count === 0 || clearing) return;
    showAlert(
      'Limpar todos os preços?',
      `Isso vai apagar o preço de ${count} produto(s) já enviados (CODIGO, PRODUTO, ML e QUANTIDADE não são afetados). Essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, limpar tudo',
          style: 'destructive',
          onPress: () => {
            showAlert(
              'Tem certeza mesmo?',
              'Confirme de novo para apagar todos os preços agora.',
              [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Limpar agora', style: 'destructive', onPress: runClear },
              ],
              { icon: 'delete', iconColor: colors.destructive },
            );
          },
        },
      ],
      { icon: 'delete', iconColor: colors.destructive },
    );
  }, [count, clearing, runClear, showAlert]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingHorizontal: 16 }]}>
      <View style={[styles.confirmHeader, { paddingTop: insets.top + 10, paddingHorizontal: 0 }]}>
        <Pressable onPress={onBack} style={styles.confirmBackButton}>
          <Icon name="chevron-right" size={18} color={colors.foreground} style={{ transform: [{ rotate: '180deg' }] }} />
        </Pressable>
        <Text style={styles.confirmHeaderTitle}>Produtos enviados</Text>
        <Pressable onPress={confirmClear} disabled={clearing || count === 0} style={[styles.confirmBackButton, { opacity: clearing || count === 0 ? 0.4 : 1 }]}>
          <Icon name="delete" size={16} color={colors.destructive} />
        </Pressable>
      </View>

      {clearing && (
        <View style={[styles.suggestionChecking, { paddingVertical: 6 }]}>
          <ActivityIndicator color={colors.destructive} />
          <Text style={styles.suggestionCheckingText}>
            Limpando preços… {clearProgress ? `${clearProgress.done}/${clearProgress.total}` : ''}
          </Text>
        </View>
      )}

      <LinearGradient colors={[colors.primary, '#0f2f8f']} style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.heroLabel}>Produtos enviados</Text>
            <Text style={styles.heroSubtitle}>Preços já atualizados no sistema</Text>
          </View>
          <View style={styles.heroIconWrap}>
            <Icon name="check-circle" size={18} color={colors.accentForeground} />
          </View>
        </View>
        <View style={styles.heroCountRow}>
          <Text style={styles.heroCount}>{count}</Text>
          <Text style={styles.heroCountUnit}>{count === 1 ? 'item' : 'itens'}</Text>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.centerState}><Text style={{ color: colors.mutedForeground }}>Carregando…</Text></View>
      ) : isError ? (
        <View style={styles.centerState}>
          <Icon name="alert-circle" size={28} color={colors.destructive} />
          <Text style={styles.emptyTitle}>Não foi possível carregar</Text>
          <Text style={{ color: colors.mutedForeground }}>Verifique a conexão e tente novamente.</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}>
          <Icon name="inbox" size={28} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>Nenhum produto enviado ainda</Text>
          <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>Escaneie um produto e registre o preço para vê-lo aqui.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <ProductRow product={item} onPress={() => onOpenConfirm({ codigo: item.codigo })} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        />
      )}
      {alertModal}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* APP RAIZ — controla qual "tela" está visível (sem expo-router)           */
/* ------------------------------------------------------------------------ */

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [screen, setScreen] = useState('scanner'); // 'scanner' | 'confirm' | 'sent'
  const [confirmParams, setConfirmParams] = useState(null);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // ---- API REAL: Baserow (planilha de preços) + Cosmos/Bluesoft (catálogo) ----
  const lookupProduct = useCallback(async (codigo) => {
    const existing = await findProductByCodigo(codigo);
    if (existing) return { ...existing, source: 'baserow' };

    const cosmos = await lookupCosmosProduct(codigo);
    if (!cosmos) {
      return { id: null, codigo, produto: '', preco: null, ml: null, quantidade: null, source: 'notfound' };
    }

    const derived = deriveProductFromCosmos(cosmos);

    // Segunda opinião por IA (Groq/Llama) só pra deixar o "corpo" do nome
    // mais enxuto (ver suggestCleanNameWithAI). O volume/fardo continuam
    // sempre calculados por código (appendPackSuffix), nunca pela IA. Se a
    // IA falhar por qualquer motivo, segue com o nome das regras de sempre.
    const aiBody = await suggestCleanNameWithAI(cosmos.description);
    const produtoFinal = aiBody ? appendPackSuffix(aiBody, derived.ml, derived.quantidade) : derived.produto;

    const created = await createProductRow({
      codigo,
      produto: produtoFinal,
      ml: derived.ml,
      quantidade: derived.quantidade,
      preco: null,
    });
    invalidateProductsCache();
    return { ...created, source: 'cosmos' };
  }, []);

  // Modo Inteligente (imagem): casa o texto lido na embalagem com o NOME do
  // produto já cadastrado no Baserow (considerando ML e variante — ver
  // findBestMatchByProductText). Não usa código de barras nenhum.
  const suggestProductByText = useCallback(async (recognizedText) => {
    // enrichRecognizedText tenta, em ordem: código na foto → memória local
    // de confirmações (aprendizado, sem internet) → casamento direto → IA
    // corretora de OCR + busca real na web (SerpApi) → casamento por
    // sílaba → última alternativa por letras em comum. Cada camada é
    // isolada (ver safeStage, dentro de enrichRecognizedText): se uma falhar
    // por qualquer motivo, as outras continuam tentando normalmente.
    //
    // Rede de segurança FINAL: mesmo que algo escape de todo o isolamento
    // interno (bug inesperado, e não só falha de rede), esse try/catch
    // garante que a tela NUNCA fica travada esperando uma Promise que
    // rejeitou — sempre devolve "não encontrado" e deixa o app seguir
    // funcionando pro próximo scan.
    try {
      const match = await enrichRecognizedText(recognizedText);
      return {
        found: match.found,
        codigo: match.product?.codigo ?? null,
        produto: match.product?.produto ?? null,
        preco: match.product?.preco ?? null,
        ml: match.product?.ml ?? null,
        quantidade: match.product?.quantidade ?? null,
        score: match.score,
        stage: match.stage,
      };
    } catch {
      return {
        found: false, codigo: null, produto: null, preco: null, ml: null, quantidade: null, score: null, stage: 'erro',
      };
    }
  }, []);

  const runClearAllPrices = useCallback(async (onProgress) => {
    const result = await clearAllPrices(onProgress);
    return result;
  }, []);

  const createProduct = useCallback(async ({ codigo, produto, preco, ml, quantidade }) => {
    const created = await createProductRow({ codigo, produto, preco, ml: ml ?? null, quantidade: quantidade ?? null });
    invalidateProductsCache();
    return created;
  }, []);

  const updateProduct = useCallback(async ({ id, data }) => {
    const updated = await updateProductRowRemote(id, data);
    invalidateProductsCache();
    return updated;
  }, []);

  // Exclui o produto inteiro (linha) da planilha — usado pelo botão de
  // lixeira na tela de confirmar preço.
  const deleteProduct = useCallback(async (id) => {
    await deleteProductRowRemote(id);
    invalidateProductsCache();
  }, []);

  const listSentProducts = useCallback(async () => {
    const all = await listAllProductsRaw();
    const items = all.filter((p) => p.preco !== null && p.preco !== undefined);
    const total = items.reduce((sum, p) => sum + (p.preco ?? 0), 0);
    return { items, total: Math.round(total * 100) / 100, count: items.length };
  }, []);
  // ---- fim da API real ----

  const refreshSentCount = useCallback(async () => {
    try {
      const result = await listSentProducts();
      setSentCount(result.count);
    } catch {
      // Silencioso: o badge só deixa de atualizar, não interrompe o uso do app.
    }
  }, [listSentProducts]);

  // Mantém a bolinha amarela sempre em dia:
  // 1) busca assim que o app abre;
  // 2) fica reconsultando o Baserow em intervalos curtos o tempo todo que a
  //    tela da câmera estiver aberta (outro caixa pode enviar preços também);
  // 3) reconsulta na hora ao voltar pra câmera (depois de enviar um preço ou
  //    de limpar tudo na tela "Produtos enviados");
  // 4) reconsulta quando o app volta pra frente (usuário trocou de app e
  //    voltou pro Preço Certo).
  useEffect(() => { refreshSentCount(); }, [refreshSentCount]);

  useEffect(() => {
    if (screen !== 'scanner') return undefined;
    const interval = setInterval(() => { refreshSentCount(); }, 10000);
    return () => clearInterval(interval);
  }, [screen, refreshSentCount]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshSentCount();
    });
    return () => subscription.remove();
  }, [refreshSentCount]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      {screen === 'scanner' && (
        <ScannerScreen
          sentCount={sentCount}
          onOpenSent={() => setScreen('sent')}
          onGoToConfirm={(params) => { setConfirmParams(params); setScreen('confirm'); }}
          lookupProduct={lookupProduct}
          suggestProductByText={suggestProductByText}
        />
      )}
      {screen === 'confirm' && confirmParams && (
        <ConfirmScreen
          params={confirmParams}
          onBack={() => setScreen('scanner')}
          onDone={() => { setScreen('scanner'); refreshSentCount(); }}
          lookupProduct={lookupProduct}
          createProduct={createProduct}
          updateProduct={updateProduct}
          deleteProduct={deleteProduct}
        />
      )}
      {screen === 'sent' && (
        <SentScreen
          onBack={() => { setScreen('scanner'); refreshSentCount(); }}
          onOpenConfirm={(params) => { setConfirmParams(params); setScreen('confirm'); }}
          listSentProducts={listSentProducts}
          clearAllPrices={runClearAllPrices}
        />
      )}
    </SafeAreaProvider>
  );
}

/* ------------------------------------------------------------------------ */
/* ESTILOS                                                                   */
/* ------------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerGradient: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  headerSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 1 },
  headerButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  countBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  countBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  hintPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  hintDot: { width: 7, height: 7, borderRadius: 4 },
  hint: { color: '#ffffff', fontSize: 14, fontFamily: 'Inter_500Medium' },
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 12 },
  permissionIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontFamily: 'Inter_700Bold' },
  permissionText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  permissionButton: { marginTop: 8, paddingHorizontal: 28, paddingVertical: 15, borderRadius: 16 },
  permissionButtonText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  permissionHint: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center', marginTop: 8 },
  modeSwitch: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', borderRadius: 16, padding: 4, overflow: 'hidden' },
  modeIndicator: { position: 'absolute', top: 4, bottom: 4, width: '50%', borderRadius: 12, backgroundColor: colors.accent },
  modeButton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modeButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  suggestionBackdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 20, paddingBottom: 130, zIndex: 10 },
  suggestionCard: { width: '100%', borderRadius: 22, padding: 20, gap: 12, backgroundColor: colors.card },
  smartOverlay: { width: '100%', paddingHorizontal: 24, gap: 16 },
  smartPanel: {
    width: 280, borderRadius: 22, padding: 16, gap: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(11,20,41,0.35)',
  },
  smartPanelTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smartPanelIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  smartPanelStatus: { flex: 1, color: '#ffffff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  smartPanelLiveBox: { gap: 3, paddingTop: 2 },
  smartPanelLiveLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.6 },
  smartPanelLiveText: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  smartPreviewBox: { width: '100%', aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  smartPreviewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  smartPreviewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  smartPreviewPlaceholderText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', lineHeight: 19 },
  smartProcessingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,20,41,0.65)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  smartProcessingText: { color: '#ffffff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  smartButtonsRow: { flexDirection: 'row', gap: 12, width: '100%' },
  smartSecondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  smartPrimaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16 },
  smartButtonText: { color: '#ffffff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  suggestionTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  suggestionTagText: { color: '#ffffff', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  suggestionChecking: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  suggestionCheckingText: { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
  suggestionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.foreground },
  suggestionSubtitle: { fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: -6, color: colors.mutedForeground },
  suggestionProduct: { borderRadius: 14, padding: 14, gap: 4, backgroundColor: colors.muted },
  suggestionProductName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground },
  suggestionProductPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.success },
  suggestionActions: { flexDirection: 'row', gap: 10 },
  aiReasoningBox: {
    marginTop: 10,
    marginBottom: 2,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(139,92,246,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  aiReasoningLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#8b5cf6',
    letterSpacing: 0.8,
  },
  aiReasoningText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#e2e8f0',
    lineHeight: 17,
  },
  suggestionSecondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  suggestionPrimaryButton: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  scanContainer: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  smartBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  smartBadgeText: { color: '#ffffff', fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  frame: { borderRadius: 20, overflow: 'hidden' },
  frameGlow: { position: 'absolute', top: 0, left: 0, borderRadius: 28, backgroundColor: '#8b5cf6' },
  analyzingRing: {
    position: 'absolute', top: '50%', left: '50%', width: 56, height: 56, marginLeft: -28, marginTop: -28,
    borderRadius: 28, borderWidth: 3, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#06b6d4', borderRightColor: '#06b6d4',
  },
  lockCheckWrap: {
    position: 'absolute', top: '50%', left: '50%', width: 52, height: 52, marginLeft: -26, marginTop: -26,
    borderRadius: 26, backgroundColor: 'rgba(16,185,129,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: 32, height: 32, borderWidth: 4 },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 20 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 20 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 20 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 20 },
  scanLine: { position: 'absolute', left: 8, right: 8, top: 2, height: 3, borderRadius: 2, overflow: 'hidden' },
  keypadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  key: { width: '30%', aspectRatio: 1.7, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 26, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  rowIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
  rowCodigo: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  rowPricePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.muted },
  rowPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.success },
  confirmHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  confirmBackButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
  confirmHeaderTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground },
  content: { padding: 20, gap: 16 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  infoCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12, backgroundColor: colors.card },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codigoBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.secondary },
  codigoText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  editBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
  editBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  nameRow: { minHeight: 36 },
  nameDisplay: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { fontSize: 22, fontFamily: 'Inter_700Bold', flexShrink: 1, color: colors.foreground },
  nameInput: { fontSize: 22, fontFamily: 'Inter_700Bold', borderBottomWidth: 2, borderBottomColor: colors.border, paddingVertical: 4, color: colors.foreground },
  metaRow: { flexDirection: 'row', gap: 8 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.muted },
  metaText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
  deleteProductRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  deleteProductRowText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.destructive },
  priceCard: { borderRadius: 22, padding: 22, alignItems: 'center' },
  priceLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.75)' },
  priceValue: { fontSize: 42, fontFamily: 'Inter_700Bold', marginTop: 4, color: '#ffffff' },
  previousPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(43,29,0,0.15)' },
  previousPriceLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(43,29,0,0.6)' },
  previousPriceValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: 'rgba(43,29,0,0.75)', textDecorationLine: 'line-through' },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16, borderWidth: 1 },
  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16 },
  successCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  successText: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginTop: 16, color: colors.foreground },
  errorTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
  heroCard: { borderRadius: 24, padding: 22, marginTop: 8, marginBottom: 18 },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroLabel: { color: '#ffffff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  heroSubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  heroIconWrap: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  heroCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 18 },
  heroCount: { color: '#ffffff', fontSize: 52, fontFamily: 'Inter_700Bold', lineHeight: 56 },
  heroCountUnit: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 4, color: colors.foreground },

  /* Modal de alerta animado (substitui Alert.alert nativo) */
  alertBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,27,51,0.45)', paddingHorizontal: 28 },
  alertCard: { width: '100%', maxWidth: 340, borderRadius: 24, padding: 24, gap: 6, alignItems: 'center', backgroundColor: colors.card, shadowColor: '#0f1b33', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  alertIconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  alertTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, textAlign: 'center' },
  alertMessage: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  alertButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 18, width: '100%' },
  alertButton: { paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  alertButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
