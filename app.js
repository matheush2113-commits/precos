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

IMPORTANTE — LEIA ANTES DE USAR:
Esta versão já conversa DE VERDADE com o Baserow (planilha de preços da
Cordeiro Supermercados, tabela 322640) e com a API Cosmos da Bluesoft
(consulta de produto por código de barras), usando os tokens que você
me passou. Não existe mais nenhum banco de dados falso/mock — é a mesma
lógica do backend original (artifacts/api-server), só que rodando direto
no app, sem servidor Node no meio.

⚠️ MODO INTELIGENTE (leitura por imagem) — ISSO NÃO RODA NO EXPO GO:
O Modo Inteligente agora tira fotos da embalagem em tempo real e lê o texto
nelas (OCR 100% no aparelho, via ML Kit no Android / Apple Vision no iOS,
usando a biblioteca "expo-text-extractor" — sem chave, sem nuvem, sem
custo), em vez de ler código de barras. Só que isso é um módulo NATIVO, e
o Expo Go (o app genérico da loja) só roda os módulos que já vêm
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

⚠️ AVISO DE SEGURANÇA — leia antes de compartilhar este Snack:
Como não há mais servidor entre o app e as APIs, os tokens abaixo (bloco
"CONFIGURAÇÃO — TOKENS") ficam GRAVADOS NO CÓDIGO e visíveis para qualquer
pessoa que abrir este Snack ou inspecionar o app (Snacks públicos podem ser
vistos por qualquer um com o link). Quem tiver o token do Baserow consegue
ler/editar/apagar sua planilha de preços inteira, e quem tiver o token do
Cosmos consegue gastar suas consultas. Recomendações:
  • Deixe este Snack como PRIVADO (não publique o link).
  • Se algum dia isso vazar, revogue e gere tokens novos no Baserow e na
    Bluesoft imediatamente.
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
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Line, Path, Polygon, Polyline } from 'react-native-svg';
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
/* CONFIGURAÇÃO — TOKENS (Baserow + Bluesoft Cosmos)                         */
/* ------------------------------------------------------------------------ */
// Veja o AVISO DE SEGURANÇA no topo do arquivo antes de compartilhar este
// Snack com alguém ou publicá-lo. Para trocar os tokens no futuro, edite
// só as duas linhas abaixo.

const BASEROW_API_TOKEN = 'Zpp1pMg1AYeG0lnXC1De0hIZID19BUM6';
const COSMOS_API_TOKEN = 'M3aC1LJBRBGtMuQMvXY2tA';

// Planilha "Cordeiro Supermercados" no Baserow: database 123771 / tabela 322640
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

/** Busca uma linha pelo CODIGO (código de barras) exato. */
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

/** Busca todas as linhas da tabela, seguindo a paginação. */
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

/** Consulta um produto pelo GTIN/código de barras no catálogo Cosmos. */
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
/* REGRAS DE NOMEAÇÃO/EMBALAGEM (mesma lógica do backend original)           */
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

// Embalagem da cerveja — vale a pena manter no nome porque muda a
// quantidade padrão do fardo (long neck = 6, o resto = 12).
const CONTAINERS = [
  { re: /LONG\s*NECK|\bLN\b/, label: 'LONG NECK' },
  { re: /\bLATA\b/, label: 'LATA' },
  { re: /\bGARRAFA\b|\bVIDRO\b/, label: 'GARRAFA' },
];

// Palavras que sabidamente NÃO são marca — usadas só quando o produto não
// bate em nenhuma marca do dicionário acima, pra "sobrar" só a marca real.
const NOISE_WORDS = [
  'UHT', 'PASTEURIZADO', 'HOMOGENEIZADO', 'LONGA VIDA', 'ESTERILIZADO',
  'TIPO A', 'TIPO C', 'TETRA PAK', 'CAIXA', 'CX', 'PACOTE', 'PCT', 'UNIDADE',
  'UND', 'UNID', 'UN', 'PET', 'RETORNAVEL', 'ONE WAY', 'TRADICIONAL',
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

/** Monta o sufixo "1LX12" / "350MLX12" / "1,5L" (sem X quando não há fardo). */
function buildVolumeSuffix(volumeForBaserow, quantidade) {
  if (volumeForBaserow === null || volumeForBaserow === undefined) return '';
  const label = formatVolume(volumeForBaserow);
  if (quantidade && quantidade > 1) return `${label}X${quantidade}`;
  return label;
}

/** Monta o nome padronizado: CATEGORIA [SUBTIPO/MARCA] [EMBALAGEM] VOLUME[XQTD]. */
function buildStandardizedName({ category, searchableUpper, volumeForBaserow, quantidade }) {
  const brand = extractBrand(searchableUpper, category);
  const subtype = extractSubtype(searchableUpper, category);
  const suffix = buildVolumeSuffix(volumeForBaserow, quantidade);

  let parts;
  if (category === 'CERVEJA') {
    parts = ['CERVEJA', brand, subtype, extractContainer(searchableUpper)];
  } else if (category === 'LEITE') {
    parts = ['LEITE', subtype, brand];
  } else if (category === 'AGUA') {
    parts = ['AGUA', brand, subtype];
  } else {
    parts = ['REFRIGERANTE', brand, subtype];
  }

  const name = parts.filter(Boolean).join(' ');
  return suffix ? `${name} ${suffix}`.replace(/\s+/g, ' ').trim() : name;
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
 * ou ÁGUA, o nome é reconstruído do zero num formato padronizado (ver bloco
 * "NOMEAÇÃO PADRONIZADA" acima). Qualquer outro produto mantém exatamente
 * o comportamento antigo (nome original da Bluesoft + sufixo de volume).
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

  let produto;
  if (category) {
    produto = buildStandardizedName({ category, searchableUpper, volumeForBaserow: ml, quantidade });
  } else {
    // Produto fora das 4 categorias conhecidas: mesma lógica de sempre,
    // sem risco de mexer no nome de algo que o script não reconhece.
    produto = description;
    if (quantidade && quantidade > 1) {
      const volumeLabel = ml ? `${formatVolume(ml)}X` : '';
      const suffix = `${volumeLabel}${quantidade}`.trim();
      if (!descriptionUpper.includes(`X${quantidade}`)) {
        produto = `${description} ${suffix}`.replace(/\s+/g, ' ').trim();
      }
    }
  }

  return { produto, ml, quantidade, needsFardoPrompt };
}

/* ------------------------------------------------------------------------ */
/* MODO INTELIGENTE — melhor correspondência por similaridade (Levenshtein)  */
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
// Correspondência por NOME/imagem é mais "ruidosa" que por código de barras
// (a OCR erra letra, junta palavra, etc), então o piso de aceitação é um
// pouco mais baixo — mas os multiplicadores de ML/variante abaixo cortam
// qualquer match que pareça o produto errado mesmo com nome parecido.
const TEXT_SUGGESTION_THRESHOLD = 0.5;

// Cache curto de todas as linhas, pra o Modo Inteligente não bater na API do
// Baserow a cada scan (mesma estratégia do backend original, 15s de TTL).
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
/*  1) similaridade de string "crua" (Levenshtein) — pega erro de OCR/typo  */
/*  2) sobreposição de palavras (token overlap) — pega ordem trocada        */
/*  3) ML extraído do texto (473ML x 350ML) — se os dois têm ML e é         */
/*     diferente, penaliza pesado (não é o mesmo item mesmo com nome igual) */
/*  4) "palavras-variante" (ZERO, DIET, LIGHT, LATA, GARRAFA, PET, LN/LONG  */
/*     NECK, SEM AÇÚCAR, INTEGRAL, DESNATADO...) — se um texto tem e o      */
/*     outro não, penaliza (evita confundir Coca-Cola com Coca-Cola Zero)   */
/* ------------------------------------------------------------------------ */

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
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
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

/**
 * Similaridade "consciente do produto" entre um texto lido (OCR ou nome
 * digitado) e o nome de um produto já cadastrado no Baserow.
 * Retorna um score de 0 a 1.
 */
function productTextSimilarity(rawA, rawB) {
  const upperA = normalizeProductText(rawA);
  const upperB = normalizeProductText(rawB);
  if (!upperA || !upperB) return 0;

  const stringScore = similarity(upperA, upperB);
  const overlapScore = tokenOverlapScore(upperA, upperB);
  let score = stringScore * 0.45 + overlapScore * 0.55;

  // Penalidade por ML diferente: dois produtos com o mesmo nome mas
  // tamanhos diferentes (473ML x 350ML) não são o mesmo item.
  const mlA = extractMl(upperA);
  const mlB = extractMl(upperB);
  if (mlA !== null && mlB !== null) {
    if (mlA !== mlB) score *= 0.35;
  }

  // Penalidade por variante diferente (ZERO, LN, GARRAFA, etc): se um dos
  // textos claramente indica uma variante que o outro não tem, o produto
  // provavelmente é diferente mesmo com o nome parecido.
  const variantsA = extractVariantSet(upperA);
  const variantsB = extractVariantSet(upperB);
  const onlyInA = [...variantsA].filter((v) => !variantsB.has(v));
  const onlyInB = [...variantsB].filter((v) => !variantsA.has(v));
  if (onlyInA.length > 0 || onlyInB.length > 0) score *= 0.55;

  return Math.max(0, Math.min(1, score));
}

/**
 * Modo Inteligente por IMAGEM: recebe o texto extraído da foto (OCR local,
 * via expo-text-extractor) e procura, no catálogo já salvo no Baserow, o
 * produto cujo NOME é mais parecido — considerando ML e variante, não só a
 * string crua. Não depende de código de barras nenhum.
 */
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
// No modo EAN-13 a câmera lê código de barras normalmente. No modo
// Inteligente ela NÃO lê código de barras — em vez disso tira fotos em
// loop e manda pra OCR local (expo-text-extractor), lendo o texto que
// estiver escrito na embalagem, igual uma pessoa leria o rótulo.
const OCR_LOOP_INTERVAL_MS = 1400;
const OCR_MIN_TEXT_LENGTH = 3;

const isSmartModeSupported = !!isTextExtractorSupported;

function ScannerScreen({ sentCount, onOpenSent, onGoToConfirm, lookupProduct, suggestProductByText }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [scanMode, setScanMode] = useState('smart');
  const [suggestion, setSuggestion] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const lockedRef = useRef(false);
  const cameraRef = useRef(null);
  const loopAliveRef = useRef(false);
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
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(SCAN_MODE_STORAGE_KEY, mode).catch(() => {});
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    setSuggestion(null);
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

  // ---- Modo Inteligente: loop de foto + OCR local em tempo real ----
  useEffect(() => {
    if (scanMode !== 'smart' || !permission?.granted || !isSmartModeSupported) {
      loopAliveRef.current = false;
      return undefined;
    }

    loopAliveRef.current = true;

    const runLoop = async () => {
      while (loopAliveRef.current) {
        if (lockedRef.current || !cameraRef.current) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, OCR_LOOP_INTERVAL_MS));
          continue;
        }
        try {
          setOcrBusy(true);
          // eslint-disable-next-line no-await-in-loop
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.25,
            skipProcessing: true,
            base64: false,
            exif: false,
          });
          if (!loopAliveRef.current || lockedRef.current) { setOcrBusy(false); continue; }
          // eslint-disable-next-line no-await-in-loop
          const lines = await extractTextFromImage(photo.uri);
          setOcrBusy(false);
          if (!loopAliveRef.current || lockedRef.current) continue;

          const recognizedText = (lines || []).join(' ').trim();
          if (recognizedText.length < OCR_MIN_TEXT_LENGTH) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, OCR_LOOP_INTERVAL_MS));
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const best = await suggestProductByText(recognizedText);
          if (!loopAliveRef.current || lockedRef.current) continue;

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
          }
        } catch {
          setOcrBusy(false);
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, OCR_LOOP_INTERVAL_MS));
      }
    };

    runLoop();
    return () => { loopAliveRef.current = false; };
  }, [scanMode, permission?.granted, suggestProductByText]);

  const handleManualEntry = useCallback(() => {
    goToConfirm(null);
  }, [goToConfirm]);

  return (
    <View style={[styles.container, { backgroundColor: colors.foreground }]}>
      {permission?.granted && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={scanMode === 'ean13' ? { barcodeTypes: ['ean13'] } : undefined}
          onBarcodeScanned={scanMode === 'ean13' ? handleBarcodeScanned : undefined}
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

      {!permission ? null : !permission.granted ? (
        <View style={styles.permissionBox}>
          <LinearGradient colors={[colors.primary, '#0f2f8f']} style={styles.permissionIcon}>
            <Icon name="camera" size={30} color="#ffffff" />
          </LinearGradient>
          <Text style={styles.permissionTitle}>Precisamos da câmera</Text>
          <Text style={styles.permissionText}>Para ler o código de barras (ou o texto da embalagem, no Modo Inteligente) e consultar o preço automaticamente.</Text>
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
      ) : (
        <View style={styles.overlay}>
          {scanMode === 'smart' && !isSmartModeSupported ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.errorTitle}>Modo Inteligente indisponível aqui</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
                A leitura de texto por imagem usa um módulo nativo (ML Kit / Apple Vision) que só funciona num app compilado
                (Dev Client / EAS Build) — não roda dentro do Expo Go nem no simulador do Snack. Use o modo EAN-13 por aqui,
                ou gere um Dev Client pra habilitar a leitura por imagem.
              </Text>
            </View>
          ) : (
            <>
              <ScanFrame locked={locked} mode={scanMode} />
              <View style={styles.hintPill}>
                <View style={[styles.hintDot, { backgroundColor: locked ? colors.success : scanMode === 'smart' ? '#8b5cf6' : colors.accent }]} />
                <Text style={styles.hint}>
                  {locked
                    ? (scanMode === 'smart' ? 'Produto identificado!' : 'Código lido!')
                    : scanMode === 'smart'
                      ? (ocrBusy ? 'Lendo o texto da embalagem…' : 'Aponte para o rótulo do produto')
                      : 'Aponte para o código de barras'}
                </Text>
              </View>
              {scanMode === 'smart' && !locked && (
                <Pressable onPress={handleManualEntry} style={({ pressed }) => [styles.hintPill, { backgroundColor: 'rgba(0,0,0,0.3)', opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={styles.hint}>Não achou? Cadastrar manualmente</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}

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

      {permission?.granted && (
        <BlurView intensity={40} tint="dark" style={[styles.modeSwitch, { bottom: insets.bottom + 28 }]}>
          <Animated.View style={[styles.modeIndicator, { left: indicatorLeft }]} />
          <ModeButton label="EAN-13" active={scanMode === 'ean13'} onPress={() => handleSelectMode('ean13')} />
          <ModeButton label="Inteligente" active={scanMode === 'smart'} onPress={() => handleSelectMode('smart')} />
        </BlurView>
      )}
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
    setIsPending(true);
    try {
      if (data?.id) {
        await updateProduct({ id: data.id, data: { produto, preco, ml, quantidade } });
      } else {
        await createProduct({ codigo: codigoInput.trim(), produto, preco, ml, quantidade });
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
                  onChangeText={setProduto}
                  placeholder="Nome do produto"
                  placeholderTextColor={colors.mutedForeground}
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
            <Text style={[styles.priceLabel, isEditing && { color: 'rgba(43,29,0,0.6)' }]}>{isEditing ? 'Novo preço' : 'Preço'}</Text>
            <Text style={[styles.priceValue, isEditing && { color: colors.accentForeground }]}>{formatCentsBuffer(digits)}</Text>
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

  // Modo Inteligente (imagem): casa o texto lido na embalagem com o NOME do
  // produto já cadastrado no Baserow (considerando ML e variante — ver
  // findBestMatchByProductText). Não usa código de barras nenhum.
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
  suggestionSecondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  suggestionPrimaryButton: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  scanContainer: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  smartBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  smartBadgeText: { color: '#ffffff', fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
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
