"""
Odlum Brown Factor Model — Configuration
"""

UNIVERSE = [
    # FINANCIALS
    'RY','POW','BMO','BN','V','PGR','TD','MCO','FFH','IFC',
    # REAL ESTATE
    'FSV',
    # MATERIALS
    'CCL.B','NTR','ALB',
    # ENERGY
    'CVE','CNQ','TOU','PPL','ENB','TRP',
    # INDUSTRIALS
    'JHX','TDG','CP','FTT',
    # CONSUMER DISCRETIONARY
    'DOL','ABNB','AMZN',
    # INFO TECH
    'MSFT','CSU','TEL','AAPL','GIB.A','VNT',
    # CONSUMER STAPLES
    'UL','MDLZ','ATD',
    # COMMUNICATION SERVICES
    'GOOG','RCI.B',
    # UTILITIES
    'BEP.UN','AEP','FTS','BIP.UN',
    # HEALTH CARE
    'SYK','GEHC','ENOV',
]

SECTORS = {
    'RY':'Financials','POW':'Financials','BMO':'Financials','BN':'Financials',
    'V':'Financials','PGR':'Financials','TD':'Financials','MCO':'Financials',
    'FFH':'Financials','IFC':'Financials',
    'FSV':'Real Estate',
    'CCL.B':'Materials','NTR':'Materials','ALB':'Materials',
    'CVE':'Energy','CNQ':'Energy','TOU':'Energy',
    'PPL':'Energy','ENB':'Energy','TRP':'Energy',
    'JHX':'Industrials','TDG':'Industrials','CP':'Industrials','FTT':'Industrials',
    'DOL':'Consumer Disc','ABNB':'Consumer Disc','AMZN':'Consumer Disc',
    'MSFT':'Info Tech','CSU':'Info Tech','TEL':'Info Tech',
    'AAPL':'Info Tech','GIB.A':'Info Tech','VNT':'Info Tech',
    'UL':'Consumer Staples','MDLZ':'Consumer Staples','ATD':'Consumer Staples',
    'GOOG':'Comm Services','RCI.B':'Comm Services',
    'BEP.UN':'Utilities','AEP':'Utilities','FTS':'Utilities','BIP.UN':'Utilities',
    'SYK':'Health Care','GEHC':'Health Care','ENOV':'Health Care',
}

COMPANY_NAMES = {
    'RY': 'Royal Bank of Canada',
    'POW': 'Power Corporation of Canada',
    'BMO': 'Bank of Montreal',
    'BN': 'Brookfield Corporation',
    'V': 'Visa Inc.',
    'PGR': 'Progressive Corporation',
    'TD': 'Toronto-Dominion Bank',
    'MCO': 'Moody\'s Corporation',
    'FFH': 'Fairfax Financial Holdings',
    'IFC': 'Intact Financial Corporation',
    'FSV': 'FirstService Corporation',
    'CCL.B': 'CCL Industries',
    'NTR': 'Nutrien Ltd.',
    'ALB': 'Albemarle Corporation',
    'CVE': 'Cenovus Energy',
    'CNQ': 'Canadian Natural Resources',
    'TOU': 'Tourmaline Oil Corp.',
    'PPL': 'Pembina Pipeline',
    'ENB': 'Enbridge Inc.',
    'TRP': 'TC Energy Corporation',
    'JHX': 'James Hardie Industries',
    'TDG': 'TransDigm Group',
    'CP': 'Canadian Pacific Kansas City',
    'FTT': 'Finning International',
    'DOL': 'Dollarama Inc.',
    'ABNB': 'Airbnb Inc.',
    'AMZN': 'Amazon.com Inc.',
    'MSFT': 'Microsoft Corporation',
    'CSU': 'Constellation Software',
    'TEL': 'TE Connectivity Ltd.',
    'AAPL': 'Apple Inc.',
    'GIB.A': 'CGI Inc.',
    'VNT': 'Vontier Corporation',
    'UL': 'Unilever PLC',
    'MDLZ': 'Mondelez International',
    'ATD': 'Alimentation Couche-Tard',
    'GOOG': 'Alphabet Inc.',
    'RCI.B': 'Rogers Communications',
    'BEP.UN': 'Brookfield Renewable Partners',
    'AEP': 'American Electric Power',
    'FTS': 'Fortis Inc.',
    'BIP.UN': 'Brookfield Infrastructure Partners',
    'SYK': 'Stryker Corporation',
    'GEHC': 'GE HealthCare Technologies',
    'ENOV': 'Enovis Corporation',
}

LISTING_TYPE = {
    'RY': 'TSX', 'POW': 'TSX', 'BMO': 'TSX', 'BN': 'TSX', 'TD': 'TSX',
    'FFH': 'TSX', 'IFC': 'TSX', 'FSV': 'TSX', 'CCL.B': 'TSX',
    'NTR': 'TSX', 'CVE': 'TSX', 'CNQ': 'TSX', 'TOU': 'TSX',
    'PPL': 'TSX', 'ENB': 'TSX', 'TRP': 'TSX', 'CP': 'TSX', 'FTT': 'TSX',
    'DOL': 'TSX', 'CSU': 'TSX', 'GIB.A': 'TSX', 'ATD': 'TSX',
    'RCI.B': 'TSX', 'BEP.UN': 'TSX', 'FTS': 'TSX', 'BIP.UN': 'TSX',
    'V': 'NYSE', 'PGR': 'NYSE', 'MCO': 'NYSE', 'ALB': 'NYSE',
    'TDG': 'NYSE', 'ABNB': 'NASDAQ', 'AMZN': 'NASDAQ', 'MSFT': 'NASDAQ',
    'TEL': 'NYSE', 'AAPL': 'NASDAQ', 'VNT': 'NYSE', 'UL': 'NYSE',
    'MDLZ': 'NASDAQ', 'GOOG': 'NASDAQ', 'AEP': 'NASDAQ',
    'SYK': 'NYSE', 'GEHC': 'NASDAQ', 'ENOV': 'NYSE',
    'JHX': 'NYSE (ADR)',
}

# TSX tickers and their yfinance suffix mapping
TSX_TICKERS = {
    'RY':'RY.TO','POW':'POW.TO','BMO':'BMO.TO','BN':'BN.TO','TD':'TD.TO',
    'FFH':'FFH.TO','IFC':'IFC.TO','FSV':'FSV.TO','CCL.B':'CCL-B.TO',
    'NTR':'NTR.TO','CVE':'CVE.TO','CNQ':'CNQ.TO','TOU':'TOU.TO',
    'PPL':'PPL.TO','ENB':'ENB.TO','TRP':'TRP.TO','CP':'CP.TO','FTT':'FTT.TO',
    'DOL':'DOL.TO','CSU':'CSU.TO','GIB.A':'GIB-A.TO','ATD':'ATD.TO',
    'RCI.B':'RCI-B.TO','BEP.UN':'BEP-UN.TO','FTS':'FTS.TO','BIP.UN':'BIP-UN.TO',
}

# US and international tickers use raw ticker (no suffix)
US_TICKERS = [
    'V','PGR','MCO','ALB','JHX','TDG','ABNB','AMZN','MSFT','TEL',
    'AAPL','VNT','UL','MDLZ','GOOG','AEP','SYK','GEHC','ENOV',
]

# Sectors with too few stocks for meaningful sector neutralization
SMALL_SECTORS = ['Real Estate','Comm Services','Materials','Health Care','Consumer Disc']

SIMFIN_MARKET = {t: 'ca' for t in TSX_TICKERS}
SIMFIN_MARKET.update({t: 'us' for t in US_TICKERS})

START_DATE = '2014-01-01'
FACTOR_WEIGHTS = {'value': 0.25, 'quality': 0.25, 'momentum': 0.25, 'revision': 0.25}
WINSORIZE_LIMITS = (0.05, 0.95)
TRANSACTION_COST_BPS = 15
MIN_SECTOR_SIZE_FOR_NEUTRALIZATION = 4

MACROTRENDS_SLUGS = {
    'RY': 'royal-bank-canada/ry',
    'POW': 'power-corporation-canada/pow',
    'BMO': 'bank-of-montreal/bmo',
    'BN': 'brookfield/bn',
    'V': 'visa/v',
    'PGR': 'progressive/pgr',
    'TD': 'toronto-dominion-bank/td',
    'MCO': 'moodys/mco',
    'FFH': 'fairfax-financial-holdings/ffh',
    'IFC': 'intact-financial/ifc',
    'FSV': 'firstservice/fsv',
    'CCL.B': 'ccl-industries/ccl',
    'NTR': 'nutrien/ntr',
    'ALB': 'albemarle/alb',
    'CVE': 'cenovus-energy/cve',
    'CNQ': 'canadian-natural-resources/cnq',
    'TOU': 'tourmaline-oil/tou',
    'PPL': 'pembina-pipeline/ppl',
    'ENB': 'enbridge/enb',
    'TRP': 'tc-energy/trp',
    'JHX': 'james-hardie-industries/jhx',
    'TDG': 'transdigm-group/tdg',
    'CP': 'canadian-pacific-railway/cp',
    'FTT': 'finning-international/ftt',
    'DOL': 'dollarama/dol',
    'ABNB': 'airbnb/abnb',
    'AMZN': 'amazon/amzn',
    'MSFT': 'microsoft/msft',
    'CSU': 'constellation-software/csu',
    'TEL': 'te-connectivity/tel',
    'AAPL': 'apple/aapl',
    'GIB.A': 'cgi-group/gib',
    'VNT': 'vontier/vnt',
    'UL': 'unilever/ul',
    'MDLZ': 'mondelez-international/mdlz',
    'ATD': 'alimentation-couche-tard/atd',
    'GOOG': 'alphabet/goog',
    'RCI.B': 'rogers-communications/rci',
    'BEP.UN': 'brookfield-renewable-partners/bep',
    'AEP': 'american-electric-power/aep',
    'FTS': 'fortis/fts',
    'BIP.UN': 'brookfield-infrastructure-partners/bip',
    'SYK': 'stryker/syk',
    'GEHC': 'ge-healthcare/gehc',
    'ENOV': 'enovis/enov',
}
