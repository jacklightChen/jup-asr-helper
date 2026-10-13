import { isRecord, isWalletAccount } from './types.ts';
import type { SolanaWallet, WalletAccount, InjectedProvider, Campaign, RewardStats } from './types.ts';
import type { Language, MessageKey, MessageValues } from './i18n.ts';
import type { DonationAmount, DonationReceipt } from './donation.ts';
import { loadDonationHistory, formatHistorySol } from './donation-history.ts';
import type { DonationHistory } from './donation-history.ts';
import { DONATION_ADDRESS, prepareDonation, verifyDonationSigned, checkDonationNetwork, submitDonation, donationStatus } from './donation.ts';
import { getWallets } from '@wallet-standard/app';
import { PublicKey } from '@solana/web3.js';
import { inspectPrepared, verifySignedTransaction, sameBytes, CURRENT_CAMPAIGN } from './transaction.ts';
import { STORAGE_KEY, chooseLanguage, getLanguage, getLocale, setLanguage, translate as t, LocalizedError, localizedErrorMessage } from './i18n.ts';
import { supportedWallets, walletBrand, selectWallet, mainnetChain, WALLET_CATALOG, preferOkxProvider, accountsInclude, donationVersion } from './wallets.ts';
import { createPhantomWallet, createInjectedWallet } from './phantom.ts';

const API = 'https://datapi.jup.ag/rewards/v1/campaigns/asr-2026-q3';
const MAX_PREPARE_AGE_MS = 45000;
type ButtonId = 'connect' | 'prepare' | 'sign' | 'refresh-status' | 'donate-small' | 'donate-large' | 'refresh-donation' | 'refresh-history' | 'copy-donation' | 'wallet-picker-close' | 'wallet-copy-url';
type AnchorId = 'phantom-open' | 'wallet-official' | 'transaction-link' | 'donation-transaction';
type ElementFor<Id extends string> = Id extends ButtonId ? HTMLButtonElement : Id extends AnchorId ? HTMLAnchorElement : Id extends 'wallet-picker' ? HTMLDialogElement : Id extends 'account-choice' ? HTMLSelectElement : HTMLElement;
function $<Id extends string>(id: Id): ElementFor<Id> {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing page element: ${id}`);
  return element as ElementFor<Id>;
}
const registry = getWallets();
interface AppState {
  selectedWallet: SolanaWallet | null; availableWallets: SolanaWallet[]; wallet: SolanaWallet | null;
  account: WalletAccount | null; accounts: readonly WalletAccount[]; metadata: Campaign | null; stats: RewardStats | null;
  prepared: ReturnType<typeof inspectPrepared> | null; preparedAt: number; busy: boolean; submitted: boolean;
  generation: number; unsubscribe: (() => void) | null; donation: DonationReceipt | null;
}
const state: AppState = { selectedWallet: null, availableWallets: [], wallet: null, account: null, accounts: [], metadata: null, stats: null,
  prepared: null, preparedAt: 0, busy: false, submitted: false, generation: 0, unsubscribe: null, donation: null };
const formatAmount = (amount: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 6 }).format(amount);
const formatSol = (lamports: bigint | number) => (Number(lamports) / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');

// Store message descriptors so changing languages also updates active status/error text.
const translatedNodes = new Map<string, () => string>();
function setText(id: string, keyOrRender: MessageKey | (() => string), values: MessageValues = {}) {
  const render = typeof keyOrRender === 'function' ? keyOrRender : () => t(keyOrRender, values);
  translatedNodes.set(id, render);
  $(id).textContent = render();
}
function showStatus(label: MessageKey, message: MessageKey | (() => string), style = '', values: MessageValues = {}) {
  $('status-box').hidden = false;
  $('status-box').className = `status panel ${style}`;
  setText('status-label', label);
  setText('status-text', message, values);
}
function applyLanguage(language: Language, persist = false) {
  setLanguage(language);
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n ?? ''); });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAria ?? '')); });
  document.querySelectorAll<HTMLElement>('[data-language]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.language === language)); });
  for (const [id, render] of translatedNodes) $(id).textContent = render();
  if (state.metadata) renderMetadata(state.metadata);
  if (state.stats) renderStats(state.stats);
  updateDiscovery(); updateFreshness(); renderDonationHistory();
  $('phantom-open').hidden = location.protocol !== 'https:';
  if (location.protocol === 'https:') {
    // Only share this page path and language; never carry account-related query data.
    const destination = new URL(location.pathname, location.origin);
    destination.searchParams.set('lang', language);
    $('phantom-open').href = `https://phantom.com/ul/browse/${encodeURIComponent(destination.href)}?ref=${encodeURIComponent(location.origin)}`;
  }
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* A blocked storage API must not block signing. */ }
    try {
      const url = new URL(location.href); url.searchParams.set('lang', language);
      history.replaceState(null, '', url);
    } catch { /* The visible switch works even when URL updates are unavailable. */ }
  }
}

function invalidatePrepared() {
  state.prepared = null;
  state.preparedAt = 0;
  $('review').hidden = true;
  $('prepare-check').textContent = '';
  updateButtons();
}

function campaignOpen() {
  const campaign = state.metadata;
  return campaign && Date.now() >= Date.parse(campaign.claimStartsAt) && Date.now() < Date.parse(campaign.claimEndsAt);
}

function updateButtons() {
  const canPrepare = state.account && state.stats && state.stats.unclaimedAmount > 0 && campaignOpen();
  $('connect').disabled = state.busy || state.submitted;
  $('prepare').disabled = state.busy || state.submitted || !canPrepare;
  $('sign').disabled = state.busy || state.submitted || !state.prepared || Date.now() - state.preparedAt >= MAX_PREPARE_AGE_MS;
  $('refresh-status').disabled = state.busy || !state.account;
  $('account-choice').disabled = state.busy || state.submitted;
  const donationPending = state.donation?.status === 'pending';
  $('donate-small').disabled = $('donate-large').disabled = state.busy || !state.account || donationPending;
  $('refresh-donation').disabled = state.busy;
  setText('connect', state.account ? 'reconnectButton' : 'connectButton');
  setText('prepare', state.prepared ? 'reprepareButton' : 'prepareButton');
}

let phantomProvider: InjectedProvider | null | undefined = null;
let phantomWallet: SolanaWallet | null = null;
const injectedCache = new Map<string, { provider: InjectedProvider; wallet: SolanaWallet | null }>();
function injectedWallet(name: string, provider: InjectedProvider | null | undefined) {
  if (!provider) return null;
  const cached = injectedCache.get(name);
  if (cached?.provider === provider) return cached.wallet;
  const wallet = createInjectedWallet(provider, name);
  injectedCache.set(name, { provider, wallet });
  return wallet;
}
function detectedWallets() {
  let wallets = supportedWallets(registry.get());
  const provider = window.phantom?.solana;
  if (provider !== phantomProvider) { phantomProvider = provider; phantomWallet = createPhantomWallet(provider); }
  if (phantomWallet && !wallets.some(wallet => walletBrand(wallet) === 'phantom')) wallets.push(phantomWallet);
  const injected: [string, InjectedProvider | null | undefined][] = [
    ['OKX Wallet', window.okxwallet?.solana],
    ['Backpack', window.backpack?.isBackpack === true ? window.backpack : null],
    ['Solflare', window.solflare?.isSolflare === true ? window.solflare : null],
    ['Trust Wallet', window.trustwallet?.solana ??
      (window.solana?.isTrust === true || window.solana?.isTrustWallet === true ? window.solana : null)],
  ];
  for (const [name, provider] of injected) {
    const wallet = injectedWallet(name, provider);
    if (wallet && walletBrand(wallet) === 'okx') wallets = preferOkxProvider(wallets, wallet);
    else if (wallet && !wallets.some(item => walletBrand(item) === walletBrand(wallet))) wallets.push(wallet);
  }
  return wallets;
}
function clearAccount(allocationKey: MessageKey = 'allocationInitial') {
  state.generation++;
  state.unsubscribe?.(); state.unsubscribe = null;
  state.wallet = null; state.account = null; state.accounts = []; state.stats = null;
  invalidatePrepared();
  $('account-info').hidden = true; $('account-choice-wrap').hidden = true;
  $('account-choice').replaceChildren();
  $('connect-check').textContent = ''; $('amount').textContent = '—';
  setText('allocation-status', allocationKey);
}
function updateDiscovery() {
  const all = registry.get();
  const found = detectedWallets();
  const previous = state.selectedWallet;
  state.availableWallets = found;
  state.selectedWallet = selectWallet(found, previous);
  if (previous && !found.includes(previous)) {
    clearAccount('allocationWalletChanged');
    showStatus('statusWalletChanged', 'reconnectPrepare');
  }
  renderWalletPicker();
  if (found.length) setText('wallet-discovery', () => t('walletDetected', { wallets: found.map(wallet => wallet.name).join(getLanguage() === 'zh' ? '、' : ', ') }));
  else if (all.length) setText('wallet-discovery', 'walletUnsupported');
  else setText('wallet-discovery', 'walletBrowserRequired');
  updateButtons();
}

function renderWalletPicker() {
  const cards = [];
  for (const item of WALLET_CATALOG) {
    const matches = state.availableWallets.filter(wallet => walletBrand(wallet) === item.brand);
    for (const [index, wallet] of (matches.length ? matches : [null]).entries()) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `wallet-card${item.brand === 'binance' ? ' wallet-featured' : ''}`;
      const icon = document.createElement('img'); icon.src = `./icons/${item.brand}.svg`; icon.alt = ''; icon.width = 44; icon.height = 44;
      const title = document.createElement('span'); title.className = 'wallet-card-name';
      title.textContent = item.name + (matches.length > 1 ? ` (${index + 1})` : '');
      const subtitle = document.createElement('span'); subtitle.className = 'wallet-card-detail';
      subtitle.textContent = t(wallet ? 'walletAvailable' : 'walletNotDetected');
      button.append(icon, title, subtitle);
      if (item.brand === 'binance') {
        const badge = document.createElement('span'); badge.className = 'wallet-tested'; badge.textContent = t('claimTested'); button.append(badge);
      }
      button.addEventListener('click', () => {
        if (state.busy || state.submitted) return;
        if (!wallet || !detectedWallets().includes(wallet)) {
          $('wallet-help').hidden = false;
          setText('wallet-help-text', 'walletOpenHelp', { wallet: item.name });
          $('wallet-official').href = item.url;
          setText('wallet-official', 'walletOfficial', { wallet: item.name });
          $('wallet-copy-status').textContent = ''; translatedNodes.delete('wallet-copy-status');
          return;
        }
        if (wallet !== state.selectedWallet) { state.selectedWallet = wallet; clearAccount('allocationWalletChanged'); }
        $('wallet-picker').close();
        run(connect);
      });
      cards.push(button);
    }
  }
  $('wallet-grid').replaceChildren(...cards);
}

function openWalletPicker() {
  if (state.busy || state.submitted) return;
  updateDiscovery(); $('wallet-help').hidden = true;
  document.body.classList.add('wallet-modal-open');
  $('wallet-picker').showModal();
}

async function api(path = '', body?: unknown): Promise<unknown> {
  const post = body !== undefined;
  let response;
  try {
    response = await fetch(API + path, { method: post ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', ...(post ? { 'content-type': 'application/json' } : {}) },
      ...(post ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(post ? 90000 : 30000) });
  } catch (error) {
    throw new LocalizedError(post ? 'errorSubmitUnknown' : 'errorApiRead');
  }
  const raw = await response.text();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  if (!response.ok) {
    const detail = isRecord(value) ? value.message ?? value.error ?? raw : raw;
    throw new LocalizedError('errorHttp', { status: response.status, detail: typeof detail === 'string' ? detail.slice(0, 500) : String(JSON.stringify(detail)).slice(0, 500) });
  }
  if (value === null) throw new LocalizedError('errorApiFormat');
  return value;
}

function validateMetadata(response: unknown): Campaign {
  const campaign = isRecord(response) ? response.campaign : null;
  const reward = isRecord(campaign) ? campaign.reward : null;
  if (!isRecord(campaign) || !isRecord(reward) || campaign.slug !== 'asr-2026-q3' || reward.assetId !== CURRENT_CAMPAIGN.mint ||
    reward.rewardName !== 'Staked JUP' || typeof campaign.claimStartsAt !== 'string' || typeof campaign.claimEndsAt !== 'string' ||
    !Number.isFinite(Date.parse(campaign.claimStartsAt)) || !Number.isFinite(Date.parse(campaign.claimEndsAt))) throw new LocalizedError('errorMetadata');
  return { claimStartsAt: campaign.claimStartsAt, claimEndsAt: campaign.claimEndsAt, reward: { onlyClaimableThroughJup: reward.onlyClaimableThroughJup } };
}

function renderMetadata(campaign: Campaign) {
  const format = (timestamp: string) => new Date(timestamp).toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  setText('campaign-date', () => t('claimWindow', { start: format(campaign.claimStartsAt), end: format(campaign.claimEndsAt) }));
  $('compatibility').hidden = true;
}

function validateStats(stats: unknown): RewardStats {
  if (!isRecord(stats) || stats.assetId !== CURRENT_CAMPAIGN.mint || stats.rewardType !== 'retroactive' ||
    typeof stats.unclaimedAmount !== 'number' || !Number.isFinite(stats.unclaimedAmount) || stats.unclaimedAmount < 0 ||
    typeof stats.claimedAmount !== 'number' || !Number.isFinite(stats.claimedAmount) || stats.claimedAmount < 0) {
    throw new LocalizedError('errorStats');
  }
  return { unclaimedAmount: stats.unclaimedAmount, claimedAmount: stats.claimedAmount };
}

function renderStats(stats: RewardStats) {
  $('amount').textContent = formatAmount(stats.unclaimedAmount);
  setText('allocation-status', () => t(stats.unclaimedAmount > 0 ? 'allocationAvailable' :
    stats.claimedAmount > 0 ? 'allocationClaimed' : 'allocationNone', { amount: formatAmount(stats.claimedAmount) }));
  updateButtons();
}

function eligibleAccounts(accounts: readonly unknown[]): WalletAccount[] {
  return accounts.filter((account): account is WalletAccount => {
    if (!isWalletAccount(account) || !mainnetChain(account) || !account.features.includes('solana:signTransaction')) return false;
    try { return sameBytes(new PublicKey(account.address).toBytes(), account.publicKey); } catch { return false; }
  });
}

async function useAccount(account: WalletAccount) {
  if (!state.wallet) throw new LocalizedError('errorConnectFirst');
  const generation = ++state.generation;
  state.account = account; state.stats = null;
  invalidatePrepared();
  $('amount').textContent = '—';
  setText('allocation-status', 'allocationLoading');
  $('account-info').hidden = false;
  $('wallet-name').textContent = state.wallet.name;
  $('account-address').textContent = account.address;
  $('connect-check').textContent = '✓';
  const stats = validateStats(await api(`/stats/${encodeURIComponent(account.address)}`));
  if (generation !== state.generation) return;
  state.stats = stats; renderStats(stats);
}

async function connect() {
  updateDiscovery();
  const wallets = detectedWallets();
  if (!wallets.length) throw new LocalizedError('errorWalletMissing');
  const wallet = state.selectedWallet;
  if (!wallet || !wallets.includes(wallet)) throw new LocalizedError('errorWalletSelection');
  const generation = state.generation;
  invalidatePrepared();
  const { accounts } = await wallet.features['standard:connect'].connect();
  if (generation !== state.generation || state.selectedWallet !== wallet || !detectedWallets().includes(wallet)) {
    throw new LocalizedError('errorWalletChanged');
  }
  const available = eligibleAccounts(accounts);
  if (!available.length) throw new LocalizedError('errorAccountUnavailable');
  state.unsubscribe?.();
  state.wallet = wallet; state.accounts = available;
  $('account-choice').replaceChildren(...available.map(account => {
    const option = document.createElement('option'); option.value = account.address;
    option.textContent = `${account.address.slice(0, 8)}…${account.address.slice(-6)}`; return option;
  }));
  $('account-choice-wrap').hidden = available.length < 2;
  if (wallet.features['standard:events']) {
    state.unsubscribe = wallet.features['standard:events'].on('change', change => {
      if (state.wallet !== wallet) return;
      const stillAvailable = state.account && accountsInclude(change.accounts ?? wallet.accounts, state.account);
      if (!stillAvailable) {
        clearAccount('allocationChanged');
        showStatus('statusAccountChanged', 'reconnectPrepare');
      }
    });
  }
  await useAccount(available[0]);
  if (state.wallet === wallet && state.account) showStatus('statusConnected', 'connectedMessage', 'success', { wallet: wallet.name });
}

function renderCodes(id: string, values: readonly string[]) {
  $(id).replaceChildren(...values.map(value => { const element = document.createElement('code'); element.textContent = value; return element; }));
}

async function prepare() {
  if (!state.account || !state.wallet) throw new LocalizedError('errorConnectFirst');
  const generation = state.generation, address = state.account.address;
  invalidatePrepared();
  showStatus('statusPreparing', 'preparingMessage');
  const [metadata, stats] = await Promise.all([api(), api(`/stats/${encodeURIComponent(address)}`)]);
  if (generation !== state.generation) throw new LocalizedError('errorAccountChanged');
  state.metadata = validateMetadata(metadata); renderMetadata(state.metadata);
  state.stats = validateStats(stats); renderStats(state.stats);
  if (!campaignOpen()) throw new LocalizedError('errorWindowClosed');
  if (state.stats.unclaimedAmount <= 0) throw new LocalizedError('errorNoReward');
  const claim = await api(`/claim?address=${encodeURIComponent(address)}`);
  if (generation !== state.generation) throw new LocalizedError('errorAccountChangedPrepare');
  const prepared = inspectPrepared(isRecord(claim) ? claim.transaction : null, address);
  const feature = state.wallet.features['solana:signTransaction'];
  if (!feature.supportedTransactionVersions?.includes(prepared.version)) throw new LocalizedError('errorTransactionVersion');
  const expectedRaw = BigInt(Math.round(state.stats.unclaimedAmount * 1e6));
  if (prepared.operations.claimedRaw !== expectedRaw) throw new LocalizedError('errorAmountMismatch');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(prepared.message)));
  if (generation !== state.generation) throw new LocalizedError('errorAccountChangedPrepare');
  const { operations } = prepared;
  $('fee-payer').textContent = prepared.feePayer;
  renderCodes('programs', prepared.programIds); renderCodes('signers', prepared.signers);
  setText('tx-meta', 'transactionMeta', { version: prepared.version, count: prepared.instructionCount });
  $('tx-hash').textContent = [...hash].map(value => value.toString(16).padStart(2, '0')).join('');
  setText('operation-effect', () => `${operations.createsEscrow ? t('createsEscrow') : ''}${operations.enablesMaxLock ? t('enablesMaxLock') : ''}${t('stakingEffect')}`);
  setText('cost-estimate', 'costEstimate', { fee: formatSol(operations.networkFeeLamports), rent: formatSol(operations.rentLamports), total: formatSol(operations.networkFeeLamports + operations.rentLamports) });
  state.prepared = prepared; state.preparedAt = Date.now();
  $('review').hidden = false; $('prepare-check').textContent = '✓';
  updateFreshness();
  showStatus('statusPrepared', 'preparedMessage', 'success');
}

function updateFreshness() {
  if (state.wallet && state.account && !accountsInclude(state.wallet.accounts, state.account)) {
    clearAccount('allocationChanged'); showStatus('statusAccountChanged', 'reconnectPrepare');
  }
  if (state.prepared) {
    const remaining = Math.max(0, Math.ceil((MAX_PREPARE_AGE_MS - (Date.now() - state.preparedAt)) / 1000));
    setText('freshness', remaining ? 'freshnessRemaining' : 'freshnessExpired', { seconds: remaining });
  }
  updateButtons();
}

async function verifyStatus() {
  if (!state.account) throw new LocalizedError('errorConnectFirst');
  const address = state.account.address, generation = state.generation;
  const stats = validateStats(await api(`/stats/${encodeURIComponent(address)}`));
  if (generation !== state.generation) return;
  state.stats = stats; renderStats(stats);
  const confirmed = stats.unclaimedAmount === 0 && stats.claimedAmount > 0;
  setText('verification-status', () => t(confirmed ? 'verificationConfirmed' : 'verificationPending', { amount: formatAmount(confirmed ? stats.claimedAmount : stats.unclaimedAmount) }));
  if (confirmed) {
    setText('result-title', 'resultConfirmed'); $('sign-check').textContent = '✓';
    showStatus('statusClaimed', () => t('claimedMessage', { amount: formatAmount(stats.claimedAmount) }), 'success');
  } else showStatus('statusUpdated', () => t('verificationPending', { amount: formatAmount(stats.unclaimedAmount) }));
}

async function signAndSubmit() {
  const { account, wallet, prepared } = state;
  if (!account || !wallet || !prepared || Date.now() - state.preparedAt >= MAX_PREPARE_AGE_MS) {
    throw new LocalizedError('errorPrepareAgain');
  }
  const generation = state.generation;
  if (state.selectedWallet !== wallet || !detectedWallets().includes(wallet)) throw new LocalizedError('errorWalletChanged');
  if (!accountsInclude(wallet.accounts, account)) throw new LocalizedError('errorAccountChanged');
  showStatus('statusAuthorization', 'authorizationMessage', '', { wallet: wallet.name });
  let signedOutput;
  try {
    const outputs = await wallet.features['solana:signTransaction'].signTransaction({
      account, chain: mainnetChain(account), transaction: Uint8Array.from(prepared.bytes)
    });
    if (!outputs || outputs.length !== 1) throw new LocalizedError('errorOutputCount');
    signedOutput = outputs[0].signedTransaction;
    if (generation !== state.generation || state.selectedWallet !== wallet || !detectedWallets().includes(wallet) ||
      !accountsInclude(wallet.accounts, account)) throw new LocalizedError('errorAccountChangedSigning');
    const signedTx = verifySignedTransaction(prepared, signedOutput, account.address);
    state.submitted = true; updateButtons();
    showStatus('statusSubmitting', 'submittingMessage');
    const result = await api('/postClaim', { address: account.address, signedTx });
    $('result').hidden = false;
    setText('result-title', 'resultApiReturned');
    $('result-json').textContent = JSON.stringify(result, null, 2);
    const transactionId = isRecord(result) ? result.transactionId ?? result.txid ?? result.signature : null;
    if (typeof transactionId === 'string' && /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(transactionId)) {
      $('transaction-id').hidden = false; $('transaction-id').textContent = transactionId;
      $('transaction-link').href = `https://solscan.io/tx/${encodeURIComponent(transactionId)}`;
      $('transaction-link').hidden = false;
      setText('result-title', 'resultVerifying');
    }
    setText('verification-status', 'verificationLoading');
    try { await verifyStatus(); } catch (error) {
      setText('verification-status', 'verificationFailed');
      showStatus('statusSubmitReturned', 'submitReturnedMessage');
    }
  } catch (error) {
    if (state.submitted) {
      $('result').hidden = false; setText('result-title', 'resultCheckSubmission');
      setText('result-json', () => localizedErrorMessage(error));
      setText('verification-status', 'verificationNoResubmit');
    }
    throw error;
  } finally { invalidatePrepared(); }
}

async function run(action: () => Promise<unknown>) {
  if (state.busy) return;
  state.busy = true; updateButtons();
  try { await action(); } catch (error) {
    showStatus('statusIncomplete', () => localizedErrorMessage(error), 'error');
  } finally { state.busy = false; updateButtons(); }
}

async function refreshDonation() {
  if (!state.donation) return;
  const receipt = state.donation;
  try {
    receipt.status = await donationStatus(receipt.signature);
    if (receipt.status === 'confirmed') void refreshDonationHistory();
    setText('donation-status', receipt.status === 'confirmed' ? 'donationConfirmed' :
      receipt.status === 'failed' ? 'donationFailed' : 'donationPending', { amount: receipt.amount });
  } catch {
    setText('donation-status', 'donationUnknown');
  }
  updateButtons();
}

async function donate(amount: DonationAmount) {
  const { account, wallet, generation } = state;
  if (!account || !wallet) throw new LocalizedError('errorConnectFirst');
  if (state.donation?.status === 'pending') throw new LocalizedError('errorDonationPending');
  if (state.selectedWallet !== wallet || !detectedWallets().includes(wallet)) throw new LocalizedError('errorWalletChanged');
  invalidatePrepared();
  setText('donation-status', 'donationPreparing', { amount });
  try {
    const versions = wallet.features['solana:signTransaction'].supportedTransactionVersions;
    const version = donationVersion(wallet);
    if (version === null) throw new LocalizedError('errorDonationTransaction');
    const prepared = await prepareDonation(account.address, amount, undefined, version);
    if (generation !== state.generation || state.selectedWallet !== wallet ||
      !accountsInclude(wallet.accounts, account)) throw new LocalizedError('errorAccountChanged');
    if (versions && !versions.includes(prepared.tx.version)) throw new LocalizedError('errorDonationTransaction');
    setText('donation-status', 'donationAuthorization', { amount, wallet: wallet.name,
      address: DONATION_ADDRESS, fee: formatSol(prepared.fee), maxFee: '0.00005' });
    const outputs = await wallet.features['solana:signTransaction'].signTransaction({ account,
      chain: mainnetChain(account), transaction: Uint8Array.from(prepared.bytes) });
    if (!outputs || outputs.length !== 1) throw new LocalizedError('errorOutputCount');
    if (generation !== state.generation || state.selectedWallet !== wallet || !detectedWallets().includes(wallet) ||
      !accountsInclude(wallet.accounts, account)) throw new LocalizedError('errorAccountChangedSigning');
    const verified = verifyDonationSigned(prepared, outputs[0].signedTransaction, account.address);
    setText('donation-status', 'donationChecking');
    const fee = await checkDonationNetwork(verified, account.address, amount);
    if (generation !== state.generation || state.selectedWallet !== wallet || !detectedWallets().includes(wallet) ||
      !accountsInclude(wallet.accounts, account)) throw new LocalizedError('errorAccountChangedSigning');
    state.donation = { amount, signature: verified.signature, status: 'pending' };
    $('donation-transaction').href = `https://solscan.io/tx/${encodeURIComponent(verified.signature)}`;
    $('donation-transaction').hidden = false; $('refresh-donation').hidden = false;
    setText('donation-status', 'donationSubmitting', { fee: formatSol(fee) }); updateButtons();
    try { await submitDonation(verified); } catch {
      setText('donation-status', 'donationUnknown');
      return; // A lost response must never cause an automatic resend.
    }
    await refreshDonation();
  } catch (error) {
    setText('donation-status', () => localizedErrorMessage(error));
  }
}

const historyState: { data: DonationHistory | null; loading: boolean; error: boolean; updatedAt: Date | null } = {
  data: null, loading: false, error: false, updatedAt: null,
};
function historyTime(date: Date) {
  return date.toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function renderDonationHistory() {
  $('refresh-history').disabled = historyState.loading;
  $('donation-history').setAttribute('aria-busy', String(historyState.loading));
  const records = historyState.data?.records ?? [];
  const status = historyState.loading ? 'historyLoading' : historyState.error ? 'historyError' :
    historyState.data?.partial ? 'historyPartial' : records.length === 0 ? 'historyEmpty' : null;
  $('history-status').textContent = status ? t(status) : '';
  $('history-status').hidden = status === null;
  $('history-records').replaceChildren(...records.map(record => {
    const row = document.createElement('li');
    const amount = document.createElement('strong'); amount.textContent = `${formatHistorySol(record.lamports)} SOL`;
    const sender = document.createElement('a'); sender.className = 'history-sender';
    sender.href = `https://solscan.io/account/${encodeURIComponent(record.sender)}`;
    sender.target = '_blank'; sender.rel = 'noopener noreferrer'; sender.title = record.sender;
    sender.textContent = `${record.sender.slice(0, 5)}…${record.sender.slice(-5)}`;
    const time = document.createElement('time');
    if (record.blockTime !== null) {
      const date = new Date(record.blockTime * 1000); time.dateTime = date.toISOString();
      time.textContent = historyTime(date); time.title = 'UTC+8';
    } else time.textContent = t('historyTimeUnknown');
    const link = document.createElement('a'); link.className = 'history-transaction';
    link.href = `https://solscan.io/tx/${encodeURIComponent(record.signature)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('historyTransaction');
    row.append(amount, sender, time, link); return row;
  }));
  $('history-updated').hidden = historyState.updatedAt === null;
  if (historyState.updatedAt) $('history-updated').textContent = t('historyUpdated', { time: historyTime(historyState.updatedAt) });
}
async function refreshDonationHistory() {
  if (historyState.loading) return;
  historyState.loading = true; historyState.error = false; renderDonationHistory();
  try {
    historyState.data = await loadDonationHistory(); historyState.updatedAt = new Date();
  } catch { historyState.error = true; }
  finally { historyState.loading = false; renderDonationHistory(); }
}
$('refresh-history').addEventListener('click', () => void refreshDonationHistory());

$('donation-address').textContent = DONATION_ADDRESS;
$('copy-donation').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(DONATION_ADDRESS);
    setText('donation-copy-status', 'donationCopied');
  } catch {
    setText('donation-copy-status', 'donationCopyFailed');
  }
});
$('donate-small').addEventListener('click', () => run(() => donate('0.01')));
$('donate-large').addEventListener('click', () => run(() => donate('0.05')));
$('refresh-donation').addEventListener('click', () => run(refreshDonation));

$('connect').addEventListener('click', openWalletPicker);
$('wallet-picker-close').addEventListener('click', () => $('wallet-picker').close());
$('wallet-picker').addEventListener('close', () => document.body.classList.remove('wallet-modal-open'));
$('wallet-picker').addEventListener('click', event => {
  if (event.target !== $('wallet-picker')) return;
  const rect = $('wallet-picker').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('wallet-picker').close();
});
$('wallet-copy-url').addEventListener('click', async () => {
  const url = new URL('https://jup-asr-helper.github.io/'); url.searchParams.set('lang', getLanguage());
  try { await navigator.clipboard.writeText(url.href); setText('wallet-copy-status', 'walletUrlCopied'); }
  catch { setText('wallet-copy-status', () => url.href); }
});
$('prepare').addEventListener('click', () => run(prepare));
$('sign').addEventListener('click', () => run(signAndSubmit));
$('refresh-status').addEventListener('click', () => run(verifyStatus));
$('account-choice').addEventListener('change', () => {
  const account = state.accounts.find(item => item.address === $('account-choice').value);
  if (account) run(() => useAccount(account));
});
registry.on('register', updateDiscovery); registry.on('unregister', updateDiscovery);
window.addEventListener('load', updateDiscovery, { once: true });
let savedLanguage;
try { savedLanguage = localStorage.getItem(STORAGE_KEY); } catch { /* Private browsing may block storage. */ }
applyLanguage(chooseLanguage({ search: location.search, saved: savedLanguage, browserLanguage: navigator.language }));
document.querySelectorAll<HTMLElement>('[data-language]').forEach(button => {
  button.addEventListener('click', () => applyLanguage(button.dataset.language === 'zh' ? 'zh' : 'en', true));
});
setInterval(updateFreshness, 1000);
api().then(response => {
  state.metadata = validateMetadata(response); renderMetadata(state.metadata); updateButtons();
}).catch(error => {
  setText('campaign-date', 'campaignUnavailable');
  $('compatibility').hidden = false;
  setText('compatibility', 'requirementsUnverified');
  showStatus('statusLoadFailed', () => localizedErrorMessage(error), 'error');
});

void refreshDonationHistory();
