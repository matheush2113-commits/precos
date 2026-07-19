/*
=================================================================================
 PREÇO CERTO — versão single-file para Expo Snack (snack.expo.dev)
=================================================================================

COMO USAR:
1. Abra https://snack.expo.dev no navegador (ou app Expo Go > aba "Snacks").
2. Apague todo o conteúdo do arquivo "App.js" que vem por padrão.
3. Cole TODO o conteúdo deste arquivo no lugar.
4. Aguarde alguns segundos: o Snack detecta e instala sozinho os pacotes
   usados nos imports (expo-camera, expo-linear-gradient, etc).
5. Escaneie o QR Code com o app Expo Go (Android/iOS) para rodar no celular
   (a câmera só funciona em dispositivo físico, não no simulador web do Snack).

⚠️ IMPORTANTE — LEIA ANTES DE USAR:
Esta versão já conversa DE VERDADE com o Baserow (planilha de preços da
Cordeiro Supermercados, tabela 322640), com a API Cosmos da Bluesoft e com a
API do GROK (xAI) para padronização inteligente e simplificada de descrições
por inteligência artificial.

⚠️ AVISO DE SEGURANÇA — leia antes de compartilhar este Snack:
Como não há mais servidor entre o app e as APIs, os tokens abaixo (bloco
"CONFIGURAÇÃO — TOKENS") ficam GRAVADOS NO CÓDIGO e visíveis para qualquer
pessoa que abrir este Snack ou inspecionar o app.
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

let extractTextFromImage = null;
let isTextExtractorSupported = false;
try {
  const textExtractorModule = require('expo-text-extractor');
  extractTextFromImage = textExtractorModule.extractTextFromImage;
  isTextExtractorSupported = !!textExtractorModule.isSupported;
} catch (e) {
  extractTextFromImage = null;
  isTextExtractorSupported = false;
}

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

function formatVolume(volume) {
  if (volume === null || volume === undefined) return '';
  if (volume > 0 && volume < 100) {
    const label = Number.isInteger(volume) ? String(volume) : volume.toFixed(1).replace('.', ',');
    return `${label}L`;
  }
  if (volume >= 1000) {
    const liters = volume / 1000;
    const label = Number.isInteger(liters) ? String(liters) : liters.toFixed(1).replace('.', ',');
    return `${label}L`;
  }
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
/* CONFIGURAÇÃO — TOKENS (Baserow + Bluesoft Cosmos + xAI Grok)             */
/* ------------------------------------------------------------------------ */

const BASEROW_API_TOKEN = 'Zpp1pMg1AYeG0lnXC1De0hIZID19BUM6';
const COSMOS_API_TOKEN = 'M3aC1LJBRBGtMuQMvXY2tA';
const GROK_API_TOKEN = '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';

const BASEROW_TABLE_ID = '322640';
const BASEROW_BASE_URL = `https://api.baserow.io/api/database/rows/table/${BASEROW_TABLE_ID}`;
const FIELD_IDS = {
  codigo: 2349768,
  produto: 2349769,
  preco: 2349771,
  ml: 2349772,
  quantidade: 2349773,
};

/* ------------------------------------------------------------------------ */
/* INTEGRAÇÃO REAL COM INTELESGÊNCIA ARTIFICIAL (GROK API)                  */
/* ------------------------------------------------------------------------ */

/**
 * Envia a descrição poluída do fabricante para a API do Grok e retorna
 * um nome limpo, direto e fácil para o cliente final ler na gôndola/etiqueta.
 */
async function generateStandardizedDescriptionWithGrok(rawDescription) {
  if (!GROK_API_TOKEN) return null;
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_TOKEN}`
      },
      body: JSON.stringify({
        model: 'grok-beta', // ou o modelo padrão ativo da API do xAI
        messages: [
          {
            role: 'system',
            content: `Você é um assistente especialista em frente de caixa e automação de supermercados.
Sua tarefa é receber descrições sujas, confusas ou excessivamente técnicas de produtos vindas de notas fiscais ou APIs de fabricantes, e transformá-las em um padrão limpo, resumido e comercial ideal para gôndolas e etiquetas de preço.

Regras Estritas:
1. Remova termos técnicos redundantes de embalagens como "UHT", "LONGA VIDA", "TETRA PAK", "PASTEURIZADO".
2. Ordene sempre como: [NOME DO PRODUTO] [MARCA] [SUBTIPO/VARIANTE] [VOLUME/PESO].
3. Mantenha em caixa alta (MAIÚSCULAS) e sem acentos.
4. NUNCA adicione textos explicativos, introduções ou aspas na resposta. Retorne APENAS o nome convertido.

Exemplos de conversão esperada:
- Entrada: "LEITE UHT COM TAMPA ITALAC INTEGRAL 1L" -> Saída: "LEITE ITALAC INTEGRAL 1L"
- Entrada: "REFRIGERANTE COCA-COLA ZERO ACUCAR GARRAFA PET 2 L" -> Saída: "COCA-COLA ZERO PET 2L"
- Entrada: "CERVEJA PILSEN LATA SKOL 350 ML" -> Saída: "CERVEJA SKOL PILSEN LATA 350ML"
- Entrada: "AGUA MINERAL NATURAL SEM GAS BONAFONT 500ML" -> Saída: "AGUA BONAFONT SEM GAS 500ML"`
          },
          {
            role: 'user',
            content: `Converta a descrição deste produto seguindo as regras à risca: "${rawDescription}"`
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) return null;
    const json = await response.json();
    const cleanText = json.choices?.[0]?.message?.content?.trim();
    return cleanText || null;
  } catch (error) {
    console.warn('Falha na consulta da API do Grok:', error);
    return null; // Fallback para a lógica de regex nativa em caso de erro
  }
}

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

async function baserowFetch(path, init) {
  const res = await fetch(`${BASEROW_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${BASEROW_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function findProductByCodigo(codigo) {
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
}

async function listAllProductsRaw() {
  const rows = [];
  let url = `/?${new URLSearchParams({ user_field_names: 'true', size: '200' }).toString()}`;
  while (url) {
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

async function deleteProductRowRemote(id) {
  const res = await baserowFetch(`/${id}/`, { method: 'DELETE' });
  if (res.status === 404) return true;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Baserow delete falhou (status ${res.status}) ${body}`);
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* INTEGRAÇÃO REAL COM COSMOS (BLUESOFT)                                     */
/* ------------------------------------------------------------------------ */

async function lookupCosmosProduct(gtin) {
  const res = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Cosmos-API-Request',
      'Content-Type': 'application/json',
      'X-Cosmos-Token': COSMOS_API_TOKEN,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cosmos lookup falhou (status ${res.status}) ${body}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------------ */
/* REGRAS DE NOMEAÇÃO LOCAIS (Para Fallback offline se a IA falhar)         */
/* ------------------------------------------------------------------------ */

function extractMl(descriptionUpper) {
  const mlMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*ML\b/i);
  if (mlMatch) return Math.round(parseFloat(mlMatch[1].replace(',', '.')));
  const literMatch = descriptionUpper.match(/(\d+(?:[.,]\d+)?)\s*L\b/i);
  if (literMatch) return Math.round(parseFloat(literMatch[1].replace(',', '.')) * 1000);
  return null;
}

function isMilkDescription(descriptionUpper) {
  return /\bLEITE\b/.test(descriptionUpper);
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

const BUG_GUARD_MAX_ML = 50;

function toSearchableUpper(text) {
  return (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

const CONTAINERS = [
  { re: /LONG\s*NECK|\bLN\b/, label: 'LONG NECK' },
  { re: /\bLATA\b/, label: 'LATA' },
  { re: /\bPET\b/, label: 'PET' },
  { re: /\bGARRAFA\b|\bVIDRO\b/, label: 'GARRAFA' },
];

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

function extractVolumeSmart(searchableUpper, category) {
  const match = searchableUpper.match(/(\d+(?:[.,]\d+)?)\s*(ML|L)\b/);
  if (!match) return null;

  const rawNumber = parseFloat(match[1].replace(',', '.'));
  const unit = match[2];

  if (unit === 'L') return Math.round(rawNumber * 1000);

  const isBugCategory = category === 'LEITE' || category === 'AGUA' || category === 'REFRIGERANTE' || category === 'CERVEJA';
  if (isBugCategory && rawNumber <= BUG_GUARD_MAX_ML) {
    return Math.round(rawNumber * 1000);
  }
  return Math.round(rawNumber);
}

function appendPackSuffix(name, ml, quantidade) {
  const base = (name || '').replace(/\s+/g, ' ').trim();
  if (ml === null || ml === undefined) return base;

  const volumeLabel = formatVolume(ml);
  const suffix = quantidade && quantidade > 1 ? `${quantidade}X${volumeLabel}` : volumeLabel;

  if (base.toUpperCase().includes(suffix.toUpperCase())) return base;
  return `${base} ${suffix}`.replace(/\s+/g, ' ').trim();
}

function buildStandardizedNameLocal({ category, searchableUpper }) {
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

/**
 * Deriva nome/ml/quantidade de um produto Cosmos combinando IA do Grok com Regex Local.
 */
async function deriveProductFromCosmos(cosmos) {
  const description = (cosmos.description ?? '').trim();
  const descriptionUpper = description.toUpperCase();
  const searchableUpper = toSearchableUpper(description);

  const category = detectProductCategory(searchableUpper);
  let ml = extractVolumeSmart(searchableUpper, category);
  const { quantidade, needsFardoPrompt } = classifyPackQuantity(descriptionUpper);

  if (ml !== null && ml >= 1000) {
    const liters = ml / 1000;
    ml = Number.isInteger(liters) ? liters : Math.round(liters * 10) / 10;
  }

  // 1. Tenta limpar e padronizar o nome comercial usando a IA do Grok
  let bodyName = await generateStandardizedDescriptionWithGrok(description);

  // 2. Se a IA falhar ou estiver sem rede, entra o Fallback Local (Regex antigo)
  if (!bodyName) {
    bodyName = category ? buildStandardizedNameLocal({ category, searchableUpper }) : description;
  }

  const produto = appendPackSuffix(bodyName, ml, quantidade);

  return { produto, ml, quantidade, needsFardoPrompt };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE (IMAGEM) — Casamento Levenshtein e variantes            */
/* ------------------------------------------------------------------------ */

function levenshtein(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const SUGGESTION_THRESHOLD = 0.6;
const TEXT_SUGGESTION_THRESHOLD = 0.5;

let productsCache = null;
const PRODUCTS_CACHE_TTL_MS = 15000;

async function listAllProductsCached() {
  const now = Date.now();
  if (productsCache && now - productsCache.fetchedAt < PRODUCTS_CACHE_TTL_MS) {
    return productsCache.rows;
  }
  const rows = await listAllProductsRaw();
  productsCache = { rows, fetchedAt: now };
  return rows;
}

function invalidateProductsCache() {
  productsCache = null;
}

const VARIANT_KEYWORDS = [
  'ZERO', 'DIET', 'LIGHT', 'SEM ACUCAR', 'SEM LACTOSE',
  'LATA', 'GARRAFA', 'PET', 'VIDRO',
  'LONG NECK', 'LN', 'LAGER', 'PILSEN', 'IPA',
  'INTEGRAL', 'DESNATADO', 'SEMIDESNATADO',
  'TRADICIONAL', 'ORIGINAL',
];

function normalizeProductText(text) {
  return (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVariantSet(normalizedUpperText) {
  const found = new Set();
  for (const keyword of VARIANT_KEYWORDS) {
    if (normalizedUpperText.includes(keyword)) found.add(keyword);
  }
  return found;
}

function tokenOverlapScore(a, b) {
  const tokensA = new Set(a.split(' ').filter((t) => t.length > 1));
  const tokensB = new Set(b.split(' ').filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size);
}

function productTextSimilarity(rawA, rawB) {
  const upperA = normalizeProductText(rawA);
  const upperB = normalizeProductText(rawB);
  if (!upperA || !upperB) return 0;

  const stringScore = similarity(upperA, upperB);
  const overlapScore = tokenOverlapScore(upperA, upperB);
  let score = stringScore * 0.45 + overlapScore * 0.55;

  const mlA = extractMl(upperA);
  const mlB = extractMl(upperB);
  if (mlA !== null && mlB !== null) {
    if (mlA !== mlB) score *= 0.35;
  }

  const variantsA = extractVariantSet(upperA);
  const variantsB = extractVariantSet(upperB);
  const onlyInA = [...variantsA].filter((v) => !variantsB.has(v));
  const onlyInB = [...variantsB].filter((v) => !variantsA.has(v));
  if (onlyInA.length > 0 || onlyInB.length > 0) score *= 0.55;

  return Math.max(0, Math.min(1, score));
}

async function findBestMatchByProductText(recognizedText) {
  const rows = await listAllProductsCached();
  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    if (!row.produto) continue;
    const score = productTextSimilarity(recognizedText, row.produto);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best || bestScore < TEXT_SUGGESTION_THRESHOLD) {
    return { found: false, score: bestScore < 0 ? null : bestScore, product: null };
  }
  return { found: true, score: bestScore, product: best };
}

/* ------------------------------------------------------------------------ */
/* MANUTENÇÃO — limpar todos os preços da planilha de uma vez                */
/* ------------------------------------------------------------------------ */

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

function ScanFrame({ locked, mode }) {
  const isSmart = mode === 'smart';
  const frameHeight = isSmart ? 240 : 150;
  const frameWidth = isSmart ? 240 : 260;
  const progress = useRef(new Animated.Value(0)).current;

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

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, frameHeight - 4] });
  const borderColor = locked ? colors.success : isSmart ? '#8b5cf6' : colors.accent;
  const lineColor = locked ? colors.success : isSmart ? '#06b6d4' : colors.accent;

  return (
    <View style={styles.scanContainer} pointerEvents="none">
      {isSmart && !locked && (
        <LinearGradient colors={['#7c3aed', '#06b6d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.smartBadge}>
          <Text style={styles.smartBadgeText}>IA · lê a embalagem</Text>
        </LinearGradient>
      )}
      <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
        <View style={[styles.corner, styles.topLeft, { borderColor }]} />
        <View style={[styles.corner, styles.topRight, { borderColor }]} />
        <View style={[styles.corner, styles.bottomLeft, { borderColor }]} />
        <View style={[styles.corner, styles.bottomRight, { borderColor }]} />
        <Animated.View style={[styles.scanLine, { backgroundColor: lineColor, opacity: locked ? 0 : 1, transform: [{ translateY }] }]} />
      </View>
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
const OCR_MIN_TEXT_LENGTH = 3;
const isSmartModeSupported = !!isTextExtractorSupported;

function ScannerScreen({ sentCount, onOpenSent, onGoToConfirm, lookupProduct, suggestProductByText }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [scanMode, setScanMode] = useState('smart');
  const [suggestion, setSuggestion] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [smartPreviewUri, setSmartPreviewUri] = useState(null);
  const lockedRef = useRef(false);
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
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(SCAN_MODE_STORAGE_KEY, mode).catch(() => {});
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    setSuggestion(null);
    setSmartPreviewUri(null);
  }, []);

  const goToConfirm = useCallback((codigo, extra) => {
    onGoToConfirm({ codigo: codigo ?? null, ...extra });
    unlock();
  }, [onGoToConfirm, unlock]);

  const handleBarcodeScanned = useCallback(async (result) => {
    if (scanMode !== 'ean13') return;
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    goToConfirm(result.data);
  }, [scanMode, goToConfirm]);

  const processSmartImage = useCallback(async (uri) => {
    if (!uri) return;
    setSmartPreviewUri(uri);
    setOcrProcessing(true);
    setSuggestion({ phase: 'checking' });
    try {
      const lines = await extractTextFromImage(uri);
      const recognizedText = (lines || []).join(' ').trim();

      if (recognizedText.length < OCR_MIN_TEXT_LENGTH) {
        setSuggestion({ phase: 'notfound', recognizedText: '' });
        return;
      }

      const best = await suggestProductByText(recognizedText);

      if (best.found && best.produto) {
        lockedRef.current = true;
        setLocked(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSuggestion({
          phase: 'result',
          recognizedText,
          matchedCodigo: best.codigo ?? null,
          produto: best.produto,
          preco: best.preco ?? null,
          ml: best.ml ?? null,
          quantidade: best.quantidade ?? null,
          score: best.score ?? null,
        });
      } else {
        setSuggestion({ phase: 'notfound', recognizedText });
      }
    } catch {
      setSuggestion({ phase: 'notfound', recognizedText: '' });
    } finally {
      setOcrProcessing(false);
    }
  }, [suggestProductByText]);

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
    } catch {}
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
    } catch {}
  }, [processSmartImage]);

  const handleManualEntry = useCallback(() => {
    goToConfirm(null);
  }, [goToConfirm]);

  const showEan13Camera = scanMode === 'ean13' && permission?.granted;
  const needsEan13Permission = scanMode === 'ean13' && !!permission && !permission.granted;
  const ean13PermissionPending = scanMode === 'ean13' && permission === null;

  let mainContent = null;
  if (ean13PermissionPending) {
    mainContent = null;
  } else if (needsEan13Permission) {
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
            A leitura de texto por imagem usa um módulo nativo que só funciona num app compilado. Use o modo EAN-13 por aqui.
          </Text>
        </View>
      </View>
    );
  } else {
    mainContent = (
      <View style={[styles.overlay, styles.smartOverlay]}>
        <View style={styles.smartPreviewBox}>
          {smartPreviewUri ? (
            <Image source={{ uri: smartPreviewUri }} style={styles.smartPreviewImage} />
          ) : (
            <View style={styles.smartPreviewPlaceholder}>
              <Icon name="camera" size={30} color="rgba(255,255,255,0.55)" />
              <Text style={styles.smartPreviewPlaceholderText}>Tire uma foto do rótulo do produto (ou escolha uma da galeria)</Text>
            </View>
          )}
          {ocrProcessing && (
            <View style={styles.smartProcessingOverlay}>
              <ActivityIndicator color="#ffffff" />
              <Text style={styles.smartProcessingText}>Lendo o texto da embalagem…</Text>
            </View>
          )}
        </View>

        {!locked && !ocrProcessing && (
          <View style={styles.smartButtonsRow}>
            <Pressable onPress={handleSmartGalleryPick} style={({ pressed }) => [styles.smartSecondaryButton, { opacity: pressed ? 0.75 : 1 }]}>
              <Icon name="image" size={16} color="#ffffff" />
              <Text style={styles.smartButtonText}>Galeria</Text>
            </Pressable>
            <Pressable onPress={handleSmartCameraCapture} style={({ pressed }) => [{ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <LinearGradient colors={[colors.accent, '#ff9d1f']} style={styles.smartPrimaryButton}>
                <Icon name="camera" size={18} color={colors.accentForeground} />
                <Text style={[styles.smartButtonText, { color: colors.accentForeground }]}>Tirar foto</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {!locked && (
          <Pressable onPress={handleManualEntry} style={({ pressed }) => [styles.hintPill, { backgroundColor: 'rgba(0,0,0,0.3)', opacity: pressed ? 0.7 : 1 }]}>
            <Text style={styles.hint}>Não achou? Cadastrar manualmente</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.foreground }]}>
      {showEan13Camera && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
          onBarcodeScanned={handleBarcodeScanned}
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
                <Text style={styles.suggestionTitle}>Não encontramos esse produto</Text>
                <Text style={styles.suggestionSubtitle}>
                  {suggestion.recognizedText
                    ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60)}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                    : 'Tente tirar a foto de novo, bem de perto do nome do produto e com boa luz.'}
                </Text>
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
                <Text style={styles.suggestionSubtitle}>
                  {suggestion.recognizedText
                    ? `Li na embalagem: "${suggestion.recognizedText.slice(0, 60)}${suggestion.recognizedText.length > 60 ? '…' : ''}"`
                    : 'Este é o mais parecido no banco de dados:'}
                </Text>
                <View style={styles.suggestionProduct}>
                  <Text style={styles.suggestionProductName}>{suggestion.produto}</Text>
                  {suggestion.preco !== null && suggestion.preco !== undefined && (
                    <Text style={styles.suggestionProductPrice}>{formatBRL(suggestion.preco)}</Text>
                  )}
                  {(suggestion.ml || suggestion.quantidade) && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {suggestion.ml ? formatVolume(suggestion.ml) : ''}
                      {suggestion.ml && suggestion.quantidade ? '  ·  ' : ''}
                      {suggestion.quantidade ? `Caixa com ${suggestion.quantidade}` : ''}
                    </Text>
                  )}
                </View>
                <View style={styles.suggestionActions}>
                  <Pressable
                    style={[styles.suggestionSecondaryButton, { borderColor: colors.border }]}
                    onPress={() => goToConfirm(null)}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Não é este</Text>
                  </Pressable>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => goToConfirm(suggestion.matchedCodigo)}
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
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* TELA 2 — CONFIRMAR PREÇO                                                  */
/* ------------------------------------------------------------------------ */

function ConfirmScreen({ params, onBack, onDone, lookupProduct, createProduct, updateProduct, deleteProduct }) {
  const insets = useSafeAreaInsets();
  const { codigo } = params;
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
      if (data.preco !== null && data.preco !== undefined) setDigits(Math.round(data.preco * 100).toString());
    }
  }, [data, codigo]);

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
    const produtoFinal = appendPackSuffix(produto, ml, quantidade);
    setIsPending(true);
    try {
      if (data?.id) {
        await updateProduct({ id: data.id, data: { produto: produtoFinal, preco, ml, quantidade } });
      } else {
        await createProduct({ codigo: codigoInput.trim(), produto: produtoFinal, preco, ml, quantidade });
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

  const handleDeleteProduct = useCallback(() => {
    if (!data?.id || isDeleting) return;
    showAlert(
      'Excluir produto?',
      `Isso vai apagar "${data.produto || produto || 'este produto'}" da planilha inteiro. Essa ação não pode ser desfeita.`,
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
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Consultando produto e IA…</Text>
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
            </View>

            <View style={styles.nameRow}>
              {editingName ? (
                <TextInput
                  style={styles.nameInput}
                  value={produto}
                  onChangeText={setProduto}
                  placeholder="Nome do produto"
                  placeholderTextColor={colors.mutedForeground}
                  autoFocus
                  onBlur={() => setEditingName(false)}
                  returnKeyType="done"
                />
              ) : (
                <Pressable onPress={() => setEditingName(true)} style={styles.nameDisplay}>
                  <Text style={styles.nameText}>{produto || 'Toque para nomear'}</Text>
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
              <Pressable onPress={handleDeleteProduct} disabled={isDeleting} style={styles.deleteProductRow}>
                <Icon name="trash-2" size={14} color={colors.destructive} />
                <Text style={styles.deleteProductRowText}>Excluir este produto</Text>
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
            <Text style={[styles.priceLabel, isEditing && { color: 'rgba(43,29,0,0.6)' }]}>{isEditing ? 'Novo preço' : 'Preço'}</Text>
            <Text style={[styles.priceValue, isEditing && { color: colors.accentForeground }]}>{formatCentsBuffer(digits)}</Text>
          </LinearGradient>

          <NumericKeypad onKeyPress={handleKeyPress} />

          <View style={styles.actionsRow}>
            <Pressable onPress={onBack} style={styles.secondaryButton}>
              <Icon name="rotate-ccw" size={16} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Rescanear</Text>
            </Pressable>
            <Pressable onPress={handleSubmit} disabled={!canSubmit} style={{ flex: 1.4 }}>
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
/* MODAL DE ALERTA ANIMADO                                                   */
/* ------------------------------------------------------------------------ */

function AnimatedAlertButton({ button, onPress }) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const isCancel = button.style === 'cancel';
  const isDestructive = button.style === 'destructive';

  const backgroundColor = isDestructive ? colors.destructive : isCancel ? colors.muted : colors.primary;
  const textColor = isDestructive ? colors.destructiveForeground : isCancel ? colors.foreground : colors.primaryForeground;

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: pressScale }] }}>
      <Pressable onPress={onPress} style={[styles.alertButton, { backgroundColor }]}>
        <Text style={[styles.alertButtonText, { color: textColor }]}>{button.text}</Text>
      </Pressable>
    </Animated.View>
  );
}

function useAppAlert() {
  const [state, setState] = useState(null);
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
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, useNativeDriver: true }),
      ]).start();
    }
  }, [state]);

  const dismiss = useCallback((onPress) => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setState(null);
      if (onPress) onPress();
    });
  }, []);

  const modal = state ? (
    <Modal transparent visible statusBarTranslucent animationType="none">
      <Animated.View style={[styles.alertBackdrop, { opacity: backdropOpacity }]}>
        <Animated.View style={[styles.alertCard, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.alertTitle}>{state.title}</Text>
          {!!state.message && <Text style={styles.alertMessage}>{state.message}</Text>}
          <View style={styles.alertButtonsRow}>
            {state.buttons.map((button, index) => (
              <AnimatedAlertButton key={index} button={button} onPress={() => dismiss(button.onPress)} />
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
    try {
      const result = await clearAllPrices((p) => setClearProgress(p));
      await load();
    } catch {
    } finally {
      setClearing(false);
      setClearProgress(null);
    }
  }, [clearAllPrices, load]);

  const confirmClear = useCallback(() => {
    if (count === 0 || clearing) return;
    showAlert('Limpar todos os preços?', 'Isso vai apagar o preço de todos produtos enviados da planilha.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar tudo', style: 'destructive', onPress: runClear }
    ]);
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

      <LinearGradient colors={[colors.primary, '#0f2f8f']} style={styles.heroCard}>
        <Text style={styles.heroLabel}>Produtos enviados</Text>
        <View style={styles.heroCountRow}>
          <Text style={styles.heroCount}>{count}</Text>
          <Text style={styles.heroCountUnit}>{count === 1 ? 'item' : 'itens'}</Text>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.centerState}><Text>Carregando…</Text></View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}><Text>Nenhum produto enviado ainda.</Text></View>
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
/* APP RAIZ                                                                 */
/* ------------------------------------------------------------------------ */

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [screen, setScreen] = useState('scanner');
  const [confirmParams, setConfirmParams] = useState(null);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  const lookupProduct = useCallback(async (codigo) => {
    const existing = await findProductByCodigo(codigo);
    if (existing) return { ...existing, source: 'baserow' };

    const cosmos = await lookupCosmosProduct(codigo);
    if (!cosmos) {
      return { id: null, codigo, produto: '', preco: null, ml: null, quantity: null, source: 'notfound' };
    }

    // Passa pela derivação inteligente (Grok com Fallback Regex)
    const derived = await deriveProductFromCosmos(cosmos);
    const created = await createProductRow({
      codigo,
      produto: derived.produto,
      ml: derived.ml,
      quantidade: derived.quantidade,
      preco: null,
    });
    invalidateProductsCache();
    return { ...created, source: 'cosmos' };
  }, []);

  const suggestProductByText = useCallback(async (recognizedText) => {
    const match = await findBestMatchByProductText(recognizedText);
    return {
      found: match.found,
      codigo: match.product?.codigo ?? null,
      produto: match.product?.produto ?? null,
      preco: match.product?.preco ?? null,
      ml: match.product?.ml ?? null,
      quantidade: match.product?.quantidade ?? null,
      score: match.score,
    };
  }, []);

  const runClearAllPrices = useCallback(async (onProgress) => {
    return clearAllPrices(onProgress);
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

  const deleteProduct = useCallback(async (id) => {
    await deleteProductRowRemote(id);
    invalidateProductsCache();
  }, []);

  const listSentProducts = useCallback(async () => {
    const all = await listAllProductsRaw();
    const items = all.filter((p) => p.preco !== null && p.preco !== undefined);
    return { items, count: items.length };
  }, []);

  const refreshSentCount = useCallback(async () => {
    try {
      const result = await listSentProducts();
      setSentCount(result.count);
    } catch {}
  }, [listSentProducts]);

  useEffect(() => { refreshSentCount(); }, [refreshSentCount]);

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
  headerTitle: { color: '#ffffff', fontSize: 17, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 1 },
  headerButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  countBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  countBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  hintPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  hintDot: { width: 7, height: 7, borderRadius: 4 },
  hint: { color: '#ffffff', fontSize: 14 },
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 12 },
  permissionIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontFamily: 'Inter_700Bold' },
  permissionText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' },
  permissionButton: { paddingHorizontal: 28, paddingVertical: 15, borderRadius: 16 },
  permissionButtonText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  modeSwitch: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', borderRadius: 16, padding: 4, overflow: 'hidden' },
  modeIndicator: { position: 'absolute', top: 4, bottom: 4, width: '50%', borderRadius: 12, backgroundColor: colors.accent },
  modeButton: { flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  modeButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  suggestionBackdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 20, paddingBottom: 130, zIndex: 10 },
  suggestionCard: { width: '100%', borderRadius: 22, padding: 20, gap: 12, backgroundColor: colors.card },
  smartOverlay: { width: '100%', paddingHorizontal: 24, gap: 16 },
  smartPreviewBox: { width: '100%', aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  smartPreviewImage: { width: '100%', height: '100%' },
  smartPreviewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  smartPreviewPlaceholderText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
  smartProcessingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,20,41,0.65)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  smartProcessingText: { color: '#ffffff', fontSize: 13 },
  smartButtonsRow: { flexDirection: 'row', gap: 12, width: '100%' },
  smartSecondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  smartPrimaryButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16 },
  smartButtonText: { color: '#ffffff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  suggestionTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  suggestionTagText: { color: '#ffffff', fontSize: 11, fontFamily: 'Inter_700Bold' },
  suggestionChecking: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  suggestionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.foreground },
  suggestionSubtitle: { fontSize: 13, color: colors.mutedForeground },
  suggestionProduct: { borderRadius: 14, padding: 14, backgroundColor: colors.muted },
  suggestionProductName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground },
  suggestionProductPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.success },
  suggestionActions: { flexDirection: 'row', gap: 10 },
  suggestionSecondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  suggestionPrimaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  scanContainer: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  smartBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  smartBadgeText: { color: '#ffffff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  frame: { borderRadius: 20, overflow: 'hidden' },
  corner: { position: 'absolute', width: 32, height: 32, borderWidth: 4 },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 20 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 20 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 20 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 20 },
  scanLine: { position: 'absolute', left: 8, right: 8, top: 2, height: 3, borderRadius: 2 },
  keypadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  key: { width: '30%', aspectRatio: 1.7, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 26, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  rowIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
  rowCodigo: { fontSize: 12, color: colors.mutedForeground },
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
  editBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accentForeground },
  nameRow: { minHeight: 36 },
  nameDisplay: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.foreground, flexShrink: 1 },
  nameInput: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.foreground, borderBottomWidth: 2, borderBottomColor: colors.border, paddingVertical: 4, width: '100%' },
  metaRow: { flexDirection: 'row', gap: 8 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.muted },
  metaText: { fontSize: 12, color: colors.mutedForeground },
  deleteProductRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  deleteProductRowText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.destructive },
  priceCard: { borderRadius: 24, padding: 20, gap: 4 },
  previousPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.08)', paddingBottom: 8, marginBottom: 4 },
  previousPriceLabel: { color: 'rgba(0,0,0,0.45)', fontSize: 12, fontFamily: 'Inter_500Medium' },
  previousPriceValue: { color: 'rgba(0,0,0,0.65)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  priceLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  priceValue: { color: '#ffffff', fontSize: 38, fontFamily: 'Inter_700Bold' },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  secondaryButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16, borderWidth: 1, backgroundColor: colors.card },
  submitButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16 },
  successCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  successText: { color: colors.foreground, fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 12 },
  errorTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginTop: 12 },
  heroCard: { borderRadius: 24, padding: 22, gap: 12, marginBottom: 16 },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  heroCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroCount: { color: '#ffffff', fontSize: 36, fontFamily: 'Inter_700Bold' },
  heroCountUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontFamily: 'Inter_500Medium' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  alertBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alertCard: { width: '100%', maxWidth: 320, borderRadius: 20, padding: 20, backgroundColor: colors.card, alignItems: 'center', gap: 12 },
  alertTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, textAlign: 'center' },
  alertMessage: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  alertButtonsRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 },
  alertButton: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  alertButtonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
