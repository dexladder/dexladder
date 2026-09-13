// Deterministic fixtures for the headless harness. Shapes mirror the real APIs.
'use strict';
const COINS = [
  ['bitcoin','BTC','Bitcoin',67850,1.34e12,'L1'],['ethereum','ETH','Ethereum',3520,4.2e11,'L1'],['tether','USDT','Tether',1,1.2e11,'Stable'],
  ['binancecoin','BNB','BNB',605,8.8e10,'Exchange'],['solana','SOL','Solana',142.31,6.6e10,'L1'],['usd-coin','USDC','USDC',1,3.4e10,'Stable'],
  ['ripple','XRP','XRP',0.62,3.4e10,'Payments'],['staked-ether','STETH','Lido Staked Ether',3515,3.3e10,'DeFi'],['dogecoin','DOGE','Dogecoin',0.163,2.3e10,'Memes'],
  ['cardano','ADA','Cardano',0.45,1.6e10,'L1'],['tron','TRX','TRON',0.132,1.1e10,'L1'],['avalanche-2','AVAX','Avalanche',36.2,1.4e10,'L1'],
  ['wrapped-bitcoin','WBTC','Wrapped Bitcoin',67800,1.0e10,'DeFi'],['shiba-inu','SHIB','Shiba Inu',0.0000242,1.4e10,'Memes'],['chainlink','LINK','Chainlink',15.1,9.4e9,'DeFi'],
  ['polkadot','DOT','Polkadot',7.2,1.0e10,'L1'],['bitcoin-cash','BCH','Bitcoin Cash',380,7.5e9,'L1'],['near','NEAR','NEAR Protocol',6.1,6.6e9,'L1'],
  ['uniswap','UNI','Uniswap',9.8,5.9e9,'DeFi'],['litecoin','LTC','Litecoin',84,6.2e9,'L1'],['matic-network','MATIC','Polygon',0.72,7.1e9,'L2'],
  ['internet-computer','ICP','Internet Computer',12.4,5.7e9,'L1'],['pepe','PEPE','Pepe',0.0000112,4.7e9,'Memes'],['arbitrum','ARB','Arbitrum',1.12,3.6e9,'L2'],
  ['optimism','OP','Optimism',2.4,2.6e9,'L2'],['render-token','RENDER','Render',7.9,3.1e9,'AI'],['fetch-ai','FET','Fetch.ai',2.2,5.5e9,'AI'],
  ['ondo-finance','ONDO','Ondo',1.35,1.9e9,'RWA'],['immutable-x','IMX','Immutable',2.1,3.1e9,'Gaming'],['aave','AAVE','Aave',92,1.4e9,'DeFi']
];
function seeded(n){ let x = Math.sin(n*9301+49297)*233280; return x-Math.floor(x); }
function spark(px, i){ const out=[]; let v=px*0.93; for(let k=0;k<168;k++){ v*= 1+ (seeded(i*1000+k)-0.5)*0.02; out.push(v);} out[167]=px; return out; }
function markets(page, per){
  const list=[]; const base = COINS.length;
  for(let i=0;i<per;i++){
    const idx=(page-1)*per+i; if(idx>=500) break;
    let c;
    if(idx<base) c=COINS[idx]; else { const s='T'+idx; c=['token-'+idx,s,'Token '+idx, 1/(idx+1)*100, 1e9/(idx+1)*50,'Other']; }
    const px=c[3], mcap=c[4];
    list.push({ id:c[0], symbol:c[1].toLowerCase(), name:c[2], image:'', current_price:px, market_cap:mcap, market_cap_rank:idx+1,
      fully_diluted_valuation:mcap*1.2, total_volume:mcap*0.07, high_24h:px*1.03, low_24h:px*0.97,
      price_change_percentage_24h:(seeded(idx)-0.45)*10, price_change_percentage_1h_in_currency:(seeded(idx+7)-0.5)*2,
      price_change_percentage_24h_in_currency:(seeded(idx)-0.45)*10, price_change_percentage_7d_in_currency:(seeded(idx+3)-0.4)*20,
      price_change_percentage_30d_in_currency:(seeded(idx+11)-0.4)*40,
      circulating_supply:mcap/px, total_supply:mcap/px*1.1, max_supply: idx%3? mcap/px*1.3 : null,
      ath:px*1.6, ath_change_percentage:-37.5, atl:px*0.01, atl_change_percentage:9900, sparkline_in_7d:{price:spark(px,idx)} });
  }
  return list;
}
const GLOBAL = { data:{ active_cryptocurrencies:17000, markets:1200, total_market_cap:{usd:2.72e12}, total_volume:{usd:1.11e11}, market_cap_percentage:{btc:59.7, eth:11.3}, market_cap_change_percentage_24h_usd:4.1 } };
// The second whole-market witness, deliberately out of step with GLOBAL above:
//   market cap  2.72T vs 2.858T   -> median 2.789T, spread 2.47%  (> the 1.5% tolerance)
//   24h volume  111B  vs 190B     -> median 150.5B, spread 26.25% (a 1.71x gap), and
//                                    BELOW the fixture ladder's own 161.5B tracked sum,
//                                    which is the live containment breach in miniature
//   BTC dominance 59.7 vs 60.2    -> median 59.95,  spread 0.42%  (inside tolerance)
// Those are the live proportions from the 2026-09-09 realtime audit. ETH dominance is
// absent here exactly as it is upstream, so that field stays single-witness and must
// name its own source rather than borrow the two-witness chip beside it.
const PAPRIKA_GLOBAL = { market_cap_usd:2.858e12, volume_24h_usd:1.90e11,
  bitcoin_dominance_percentage:60.2, market_cap_change_24h:3.9, cryptocurrencies_number:16400 };
const TRENDING = { coins: COINS.slice(4,11).map((c,i)=>({item:{id:c[0],symbol:c[1],name:c[2],market_cap_rank:i+5,thumb:'',data:{price:c[3],price_change_percentage_24h:{usd:3.2}}}})) };
const FNG = { data:[{value:'62', value_classification:'Greed', timestamp:String(Math.floor(Date.now()/1000))}] };
const RATES = { rates:{ usd:{value:1}, eur:{value:0.92}, inr:{value:83.1}, btc:{value:1/67850} } };
const CATEGORIES = [
  {id:'layer-1',name:'Layer 1 (L1)',market_cap:2.1e12,market_cap_change_24h:3.1,volume_24h:8e10,top_3_coins:['','',''],top_3_coins_id:['bitcoin','ethereum','solana']},
  {id:'decentralized-finance-defi',name:'Decentralized Finance (DeFi)',market_cap:7.5e10,market_cap_change_24h:-1.2,volume_24h:9e9,top_3_coins:['','',''],top_3_coins_id:['chainlink','uniswap','aave']},
  {id:'meme-token',name:'Meme',market_cap:5e10,market_cap_change_24h:8.4,volume_24h:1.2e10,top_3_coins:['','',''],top_3_coins_id:['dogecoin','shiba-inu','pepe']},
  {id:'artificial-intelligence',name:'Artificial Intelligence (AI)',market_cap:2.9e10,market_cap_change_24h:5.5,volume_24h:3e9,top_3_coins:['','',''],top_3_coins_id:['render-token','fetch-ai','near']},
  {id:'real-world-assets-rwa',name:'Real World Assets (RWA)',market_cap:1.1e10,market_cap_change_24h:0.4,volume_24h:8e8,top_3_coins:['','',''],top_3_coins_id:['ondo-finance','chainlink','bitcoin']},
  {id:'layer-2',name:'Layer 2 (L2)',market_cap:1.4e10,market_cap_change_24h:-2.5,volume_24h:2e9,top_3_coins:['','',''],top_3_coins_id:['matic-network','arbitrum','optimism']},
  {id:'wrapped-tokens',name:'Wrapped-Tokens',market_cap:1.2e10,market_cap_change_24h:1.0,volume_24h:5e8,top_3_coins:['','',''],top_3_coins_id:['wrapped-bitcoin','staked-ether','bitcoin']},
  {id:'liquid-staking-tokens',name:'Liquid Staking Tokens',market_cap:3.3e10,market_cap_change_24h:1.1,volume_24h:4e8,top_3_coins:['','',''],top_3_coins_id:['staked-ether','ethereum','solana']},
  {id:'gaming',name:'Gaming (GameFi)',market_cap:9e9,market_cap_change_24h:-4.1,volume_24h:7e8,top_3_coins:['','',''],top_3_coins_id:['immutable-x','render-token','near']}
];
function gtPools(kind){
  const data=[]; for(let i=0;i<20;i++){ const age=kind==='new'? Date.now()-i*90000 : Date.now()-(i+1)*3.6e6*24;
    data.push({ id:'eth_0xpool'+i, type:'pool', attributes:{ name:'TKN'+i+' / WETH', address:'0xp'+i, base_token_price_usd:String(0.001*(i+1)), reserve_in_usd:String(50000*(i+1)), fdv_usd:String(2e6*(i+1)), market_cap_usd:null,
      pool_created_at:new Date(age).toISOString(), price_change_percentage:{m5:'0.5',h1:String((i%5-2)*2),h6:String((i%7-3)*3),h24:String((i%9-4)*5)},
      transactions:{m5:{buys:3,sells:1},h1:{buys:40,sells:22},h6:{buys:210,sells:150},h24:{buys:900,sells:700}},
      volume_usd:{m5:'900',h1:'12000',h6:'70000',h24:'250000'} }, relationships:{ base_token:{data:{id:'eth_0xtoken'+i,type:'token'}}, network:{data:{id:'eth',type:'network'}} } });
  }
  const included = data.map((p,i)=>({id:'eth_0xtoken'+i,type:'token',attributes:{address:'0x'+('t'+i).padEnd(40,'0').slice(0,40),name:'Token '+i,symbol:'TKN'+i}}));
  return {data, included};
}
function gtOhlcv(){ const list=[]; let px=0.01; for(let i=100;i>0;i--){ px*=1+(seeded(i)-0.5)*0.06; const o=px, c=px*(1+(seeded(i+1)-0.5)*0.03); list.push([Math.floor(Date.now()/1000)-i*3600, o, Math.max(o,c)*1.01, Math.min(o,c)*0.99, c, 5000+seeded(i)*9000]); } return {data:{attributes:{ohlcv_list:list}}}; }
const GOPLUS = { code:1, message:'OK', result:{ '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd': { is_honeypot:'0', is_mintable:'1', transfer_pausable:'0', trading_cooldown:'0', is_blacklisted:'0', buy_tax:'0.02', sell_tax:'0.12', is_open_source:'1', owner_address:'0x1111111111111111111111111111111111111111', can_take_back_ownership:'0', token_name:'Fixture Token', token_symbol:'FIX', lp_holders:[{address:'0x2',percent:'0.8',is_locked:1}], holder_count:'1200', creator_address:'0x3', lp_total_supply:'1000' } } };
const LLAMA_CHAINS = [ {name:'Ethereum',tvl:6.2e10,tokenSymbol:'ETH',gecko_id:'ethereum'},{name:'Solana',tvl:9.1e9,tokenSymbol:'SOL',gecko_id:'solana'},{name:'BSC',tvl:5.5e9,tokenSymbol:'BNB',gecko_id:'binancecoin'},{name:'Tron',tvl:8.2e9,tokenSymbol:'TRX',gecko_id:'tron'},{name:'Base',tvl:4.0e9,tokenSymbol:null,gecko_id:null},{name:'Arbitrum',tvl:3.1e9,tokenSymbol:'ARB',gecko_id:'arbitrum'} ];
const LLAMA_DEXS = { protocols:[{name:'Uniswap',total24h:2.1e9,total7d:1.4e10,chains:['Ethereum','Base','Arbitrum']},{name:'PancakeSwap',total24h:1.3e9,total7d:8e9,chains:['BSC','Ethereum']},{name:'Raydium',total24h:9e8,total7d:6e9,chains:['Solana']}], total24h:6.5e9, total7d:4.2e10, totalDataChartBreakdown:[] };
const LLAMA_FEES = { protocols:[{name:'Tether',total24h:1.2e7,total7d:8e7,category:'Stablecoin Issuer'},{name:'Ethereum',total24h:2.4e6,total7d:1.7e7,category:'Chain'},{name:'Solana',total24h:1.9e6,total7d:1.3e7,category:'Chain'}], total24h:4e7 };
const LLAMA_YIELDS = { status:'success', data:[ {chain:'Ethereum',project:'lido',symbol:'STETH',tvlUsd:2.4e10,apy:3.1,apyBase:3.1,apyReward:null,stablecoin:false,ilRisk:'no',exposure:'single',pool:'p1',il7d:null},
 {chain:'Ethereum',project:'aave-v3',symbol:'USDC',tvlUsd:1.1e9,apy:5.4,apyBase:5.4,apyReward:null,stablecoin:true,ilRisk:'no',exposure:'single',pool:'p2',il7d:null},
 {chain:'Arbitrum',project:'uniswap-v3',symbol:'WETH-USDC',tvlUsd:2.2e8,apy:18.2,apyBase:18.2,apyReward:null,stablecoin:false,ilRisk:'yes',exposure:'multi',pool:'p3',il7d:-1.4},
 {chain:'Solana',project:'marinade',symbol:'MSOL',tvlUsd:9e8,apy:7.2,apyBase:7.2,apyReward:null,stablecoin:false,ilRisk:'no',exposure:'single',pool:'p4',il7d:null} ] };
const TREASURY = { total_holdings:1340000, total_value_usd:9.1e10, market_cap_dominance:6.4, companies:[ {name:'Strategy',symbol:'NASDAQ:MSTR',country:'US',total_holdings:640000,total_entry_value_usd:4.7e10,total_current_value_usd:4.3e10,percentage_of_total_supply:3.05},{name:'MARA Holdings',symbol:'NASDAQ:MARA',country:'US',total_holdings:52000,total_entry_value_usd:3.2e9,total_current_value_usd:3.5e9,percentage_of_total_supply:0.25} ] };
const HL_META = (function(){ const names=['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','SUI','ARB']; const px=[67850,3520,142.3,0.62,0.163,0.45,36.2,15.1,1.1,1.12];
  return [ {universe: names.map(n=>({name:n,szDecimals:3,maxLeverage:20}))}, names.map((n,i)=>({funding:String(((i%3)-1)*0.0000125+0.00001), openInterest:String(1e8/px[i]), prevDayPx:String(px[i]*0.99), dayNtlVlm:String(1e9/(i+1)), premium:'0.0001', oraclePx:String(px[i]), markPx:String(px[i]*1.0001), midPx:String(px[i])})) ]; })();
const DVOL = { result:{ data:[[Date.now()-3600e3, 41.2, 42.0, 40.8, 41.6]], continuation:null } };
const POLY_EVENTS = { data:[ { id:'e1', title:'Will Bitcoin close above $70,000 on Sep 30?', slug:'btc-70k-sep30', endDate:new Date(Date.now()+20*864e5).toISOString(), volume:'1250000', liquidity:'240000', tags:[{label:'Crypto',slug:'crypto'}],
   markets:[{ id:'m1', question:'Will Bitcoin close above $70,000 on Sep 30?', outcomes:'["Yes","No"]', outcomePrices:'["0.41","0.59"]', clobTokenIds:'["111","222"]', closed:false, volume:'1250000', endDate:new Date(Date.now()+20*864e5).toISOString() }] },
  { id:'e2', title:'Fed cuts rates in September?', slug:'fed-cut-sep', endDate:new Date(Date.now()+12*864e5).toISOString(), volume:'8000000', liquidity:'900000', tags:[{label:'Economy',slug:'economy'}],
   markets:[{ id:'m2', question:'Fed cuts rates in September?', outcomes:'["Yes","No"]', outcomePrices:'["0.88","0.12"]', clobTokenIds:'["333","444"]', closed:false, volume:'8000000', endDate:new Date(Date.now()+12*864e5).toISOString() }] },
  { id:'e3', title:'ETH above $4,000 on Sep 15?', slug:'eth-4k', endDate:new Date(Date.now()+5*864e5).toISOString(), volume:'300000', liquidity:'40000', tags:[{label:'Crypto',slug:'crypto'}],
   markets:[{ id:'m3', question:'ETH above $4,000 on Sep 15?', outcomes:'["Yes","No"]', outcomePrices:'["0.22","0.78"]', clobTokenIds:'["555","666"]', closed:false, volume:'300000', endDate:new Date(Date.now()+5*864e5).toISOString() }] } ], next_cursor:null };
const POLY_MID = { mid:'0.415' };
const MEMPOOL_DA = { progressPercent:44.4, difficultyChange:2.1, estimatedRetargetDate:Date.now()+6*864e5, remainingBlocks:1120, remainingTime:6*864e5, previousRetarget:-1.2, nextRetargetHeight:912960, timeAvg:600000 };
const TIP_HEIGHT = '911840';
const WIKI = (title)=>({ items: Array.from({length:14},(_,i)=>({project:'en.wikipedia',article:title,granularity:'daily',timestamp:'2026082'+String(i).padStart(2,'0'),views: 20000 + (i>6? 6000:0) + Math.floor(seeded(i+title.length)*3000)})) });
const COINLORE = { data: COINS.slice(0,30).map((c,i)=>({ id:String(i), symbol:c[1], name:c[2], nameid:c[0], rank:i+1, price_usd:String(c[3]), percent_change_24h:'1.5', percent_change_1h:'0.2', percent_change_7d:'-2.1', market_cap_usd:String(c[4]), volume24:c[4]*0.07, csupply:String(c[4]/c[3]), tsupply:String(c[4]/c[3]*1.1), msupply:'' })), info:{coins_num:14000,time:Math.floor(Date.now()/1000)} };
const COINLORE_TICKER = COINLORE.data;
/* Eight headlines per feed, two for each of newsCat()'s four buckets
   (market / policy / tech / defi), so the categorised bands on the News
   desk — #frontPkg and #newsSections — have something to render. The
   old fixture carried two items per feed, which could never fill a band
   (renderSections skips a category with fewer than 2), so the desk's
   whole categorised front page was untested. Titles carry the feed name
   because loadNews dedupes by lowercased title across every source. */
const NEWS_ITEMS = (name)=>[
  ['Bitcoin holds $67k as spot volumes steady', 'market'],
  ['Ether leads the majors higher in thin weekend trade', 'market'],
  ['Senate committee advances a crypto market-structure bill', 'policy'],
  ['SEC clears a second spot ETF listing', 'policy'],
  ['Validators ship a mainnet client upgrade', 'tech'],
  ['A rollup testnet opens to developers', 'tech'],
  ['Uniswap liquidity deepens on Base', 'defi'],
  ['A stablecoin yield vault draws fresh deposits', 'defi']
].map(([t,cat],i)=>({ title:`${name}: ${t}`, cat, link:`https://example.com/${name}/${i+1}`,
  ms: Date.now() - (i+1)*1800e3, body:`Fixture body for ${name} item ${i+1}.` }));
const RSS = (name)=>`<?xml version="1.0"?><rss><channel><title>${name}</title>
${NEWS_ITEMS(name).map(it=>`<item><title>${it.title}</title><link>${it.link}</link><pubDate>${new Date(it.ms).toUTCString()}</pubDate><description>${it.body}</description></item>`).join('\n')}
</channel></rss>`;
/* rss2json's own shape. Its pubDate is UTC with NO zone suffix — the exact
   format that makes a naive Date.parse read it as local time and throw every
   "Xh ago" off by the viewer's offset. The fixture keeps that trap in place. */
const RSS2JSON = (name)=>({ status:'ok', feed:{ url:`https://${name}/rss`, title:name },
  items: NEWS_ITEMS(name).map(it=>({ title:it.title, link:it.link, guid:it.link,
    pubDate: new Date(it.ms).toISOString().replace('T',' ').slice(0,19),
    author:'', thumbnail:'', description:it.body, content:it.body, enclosure:{}, categories:[] })) });
const COIN_DETAIL = (id)=>({ id, symbol:id.slice(0,3), name:id, description:{en:'Fixture description for '+id+'. A network for testing.'}, links:{homepage:['https://example.org'],whitepaper:'https://example.org/wp.pdf',repos_url:{github:['https://github.com/example/x']},twitter_screen_name:'example',subreddit_url:'https://reddit.com/r/example',blockchain_site:['https://etherscan.io/token/0x1']}, platforms:{ethereum:'0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'}, categories:['Smart Contract Platform','Layer 1 (L1)'], developer_data:{forks:1200,stars:4500,subscribers:200,total_issues:900,closed_issues:800,pull_requests_merged:3000,pull_request_contributors:150,commit_count_4_weeks:88}, community_data:{twitter_followers:250000,reddit_subscribers:80000,telegram_channel_user_count:null}, market_data:{current_price:{usd:100}} });
const TICKERS = { tickers:[ {base:'BTC',target:'USDT',market:{name:'Binance',identifier:'binance'},last:67850,volume:120000,converted_volume:{usd:8e9},trust_score:'green',bid_ask_spread_percentage:0.01,cost_to_move_up_usd:2500000,cost_to_move_down_usd:2400000,is_stale:false,trade_url:'https://binance.com'},
  {base:'BTC',target:'USD',market:{name:'Coinbase Exchange',identifier:'gdax'},last:67855,volume:30000,converted_volume:{usd:2e9},trust_score:'green',bid_ask_spread_percentage:0.02,cost_to_move_up_usd:900000,cost_to_move_down_usd:850000,is_stale:false,trade_url:'https://coinbase.com'},
  {base:'BTC',target:'USDT',market:{name:'TinyDex',identifier:'tinydex'},last:67700,volume:12,converted_volume:{usd:800000},trust_score:'yellow',bid_ask_spread_percentage:0.9,cost_to_move_up_usd:9000,cost_to_move_down_usd:8000,is_stale:true,trade_url:''} ] };
const EXCHANGES = [ {id:'binance',name:'Binance',year_established:2017,country:'Cayman Islands',trust_score:10,trust_score_rank:1,trade_volume_24h_btc:280000,image:''},{id:'gdax',name:'Coinbase Exchange',year_established:2012,country:'United States',trust_score:10,trust_score_rank:2,trade_volume_24h_btc:45000,image:''},{id:'kraken',name:'Kraken',year_established:2011,country:'United States',trust_score:10,trust_score_rank:3,trade_volume_24h_btc:20000,image:''} ];
function marketChart(days){ const prices=[]; let px=60000; const n=days; for(let i=n;i>=0;i--){ px*=1+(seeded(i*3)-0.5)*0.04; prices.push([Date.now()-i*864e5, px]); } return {prices, market_caps:prices.map(p=>[p[0],p[1]*1.97e7]), total_volumes:prices.map(p=>[p[0],3e10])}; }
module.exports = { PAPRIKA_GLOBAL, COINS, markets, GLOBAL, TRENDING, FNG, RATES, CATEGORIES, gtPools, gtOhlcv, GOPLUS, LLAMA_CHAINS, LLAMA_DEXS, LLAMA_FEES, LLAMA_YIELDS, TREASURY, HL_META, DVOL, POLY_EVENTS, POLY_MID, MEMPOOL_DA, TIP_HEIGHT, WIKI, COINLORE, COINLORE_TICKER, RSS, RSS2JSON, NEWS_ITEMS, COIN_DETAIL, TICKERS, EXCHANGES, marketChart };
