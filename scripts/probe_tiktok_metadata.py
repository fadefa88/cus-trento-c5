#!/usr/bin/env python3
"""Diagnose public TikTok metadata sources; public video IDs only. No cookies or secrets."""
import html
import json
import re
import requests
from urllib.parse import urlparse

IDS=["7697221559471050017","7696852069482761505","7695745155537636641","7693511007867538721","7689089002758032673","7688713479485705505","7688330444198120736","7677929285130161441","7675708985785240864","7666400053082197280"]
HEADERS=[
 {"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36","Accept-Language":"it-IT,it;q=0.9,en-US;q=0.8"},
 {"User-Agent":"facebookexternalhit/1.1","Accept":"text/html,application/json,*/*"},
]
def clean(v):
 t=html.unescape(re.sub(r"<[^>]*>","",str(v or ""))).strip()
 return t[:550]
def describe_json(value,dep=0):
 if dep>4 or not isinstance(value,dict):return {}
 result={}
 for k,v in value.items():
  if k in ["title","desc","description","video_description","text","shareTitle","shareMeta","og:description"] and isinstance(v,str):
   result[k]=clean(v)
  if k in ["itemInfo","itemStruct","video","seo","props","data","__DEFAULT_SCOPE__"] and isinstance(v,dict):
   result[k]=describe_json(v,dep+1)
 return result
def discover_fields(data,path="",depth=0):
    """Read-only deep scan of TikTok page hydration data."""
    if depth > 18:return []
    out=[]
    if isinstance(data,dict):
        for key,value in data.items():
            target=path+"."+str(key)
            if isinstance(value,str) and (key.lower() in ("desc","description","title","text","caption","sharetitle","sharemeta","nickname") or "video" in str(key).lower()):
                if value.strip():
                    out.append({"path":target,"value":clean(value)})
            elif isinstance(value,(dict,list)):
                out+=discover_fields(value,target,depth+1)
    elif isinstance(data,list):
        for idx,elem in enumerate(data[:30]):out+=discover_fields(elem,path+"["+str(idx)+"]",depth+1)
    return out[:120]

def probe(url,headers,params=None):
 try:
  response=requests.get(url,params=params,headers=headers,timeout=10,allow_redirects=True)
  snippet=response.text[:900000]
  type=response.headers.get("content-type","")
  vals={}
  if "json" in type or snippet.lstrip().startswith("{"):
   try:
    data=response.json()
    vals=describe_json(data)
    if url.endswith("/oembed"):vals={**vals,"raw":data}
    if "itemInfo" in data:vals["itemInfo"]=describe_json(data["itemInfo"])
    if "itemList" in data:vals["itemListN"]=len(data["itemList"])
    if "itemInfo" in (data.get("data") or {}): vals["dataItemInfo"]=describe_json(data["data"]["itemInfo"])
   except Exception as e: vals={"decode_error":str(e)[:80]}
  else:
   for pattern,name in [
      (r'<meta[^>]+property=["\x27]og:description["\x27][^>]+content=["\x27]([^"\x27]+)',"og_description"),
      (r'<meta[^>]+name=["\x27]description["\x27][^>]+content=["\x27]([^"\x27]+)',"meta_description"),
      (r'<title[^>]*>(.*?)</title>',"html_title"),
      (r'<script[^>]+id=["\x27]__UNIVERSAL_DATA_FOR_REHYDRATION__["\x27][^>]*>(.*?)</script>',"universal_script")
   ]:
    match=re.search(pattern,snippet,re.I|re.S)
    if match:
     if name=="universal_script":
      try:
       data=json.loads(match.group(1))
       vals[name]=discover_fields(data)[:50]
       scope=data.get("__DEFAULT_SCOPE__",{})
       video = scope.get("webapp.video-detail", {}) if isinstance(scope,dict) else {}
       details = (video.get("itemInfo") or {}).get("itemStruct") or {}
       vals["actual_post"]={"id":details.get("id"),"caption":details.get("desc"),"create_time":details.get("createTime")} if isinstance(details,dict) else {}
       vals["scope_keys"]=list(scope.keys()) if isinstance(scope,dict) else []
       vals["video_scopes"]={key:discover_fields(value)[:100] for key,value in scope.items() if "video" in key.lower() or "item" in key.lower()} if isinstance(scope,dict) else {}
       vals["video_scope_data_types"]={key:list(value.keys())[:30] if isinstance(value,dict) else str(type(value).__name__) for key,value in scope.items() if "video" in key.lower() or "item" in key.lower()} if isinstance(scope,dict) else {}

      except Exception: vals[name]="exists"
     else: vals[name]=clean(match.group(1))
   interesting=("title","description","lark:url:video_title","lark:url:video_brand_name","og:title","og:description","twitter:title","twitter:description")
   metas={}
   for match in re.findall(r"<meta\s+[^>]+>",snippet,re.I):
    attrs=dict((k.lower(),html.unescape(v)) for k,v in re.findall(r'(name|property|content)\s*=\s*["\x27]([^"\x27]*)["\x27]',match,re.I))
    key=(attrs.get("name") or attrs.get("property") or "").lower()
    if key in interesting and attrs.get("content"):metas[key]=attrs["content"][:1000]
   vals["metadata_texts"]=metas
   vals["itemInfo_exists"]="itemInfo" in snippet
   vals["itemStruct_exists"]="itemStruct" in snippet
   vals["tiktok_embeds"]=len(re.findall(r"tiktok-embed",snippet))
   meta_keys=re.findall(r'<meta[^>]+(?:name|property)=["\\x27]([^"\\x27]+)',snippet,re.I)
   vals["meta_tags"]=meta_keys[:70]
   vals["desc_occurrences"]=len(re.findall(r'"desc"\s*:',snippet))
   vals["video_id_present"]=bool(params and "itemId" in params)
  print(json.dumps({"kind":urlparse(url).path,"status":response.status_code,"type":type[:60],"bytes":len(response.content),"final_url":urlparse(response.url).path,"fields":vals},ensure_ascii=False),flush=True)
 except Exception as e: print(json.dumps({"kind":urlparse(url).path,"error":str(e)[:200]}),flush=True)

for vid in IDS:
 print("VIDEO",vid,flush=True)
 probe(f"https://www.tiktok.com/@custrentoc5/video/{vid}",HEADERS[0])
