#!/usr/bin/env python3
"""Diagnose public TikTok metadata sources; public video IDs only. No cookies or secrets."""
import html
import json
import re
import requests
from urllib.parse import urlparse

IDS=["7697221559471050017","7696852069482761505","7695745155537636641","7693511007867538721"]
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
    if url.endswith("/oembed"):vals={**vals,"thumbnail_width":data.get("thumbnail_width"),"thumbnail_height":data.get("thumbnail_height"),"author_name":data.get("author_name")}
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
       vals[name]=describe_json(data)
      except Exception: vals[name]="exists"
     else: vals[name]=clean(match.group(1))
   vals["tiktok_embeds"]=len(re.findall(r"tiktok-embed",snippet))
  print(json.dumps({"kind":urlparse(url).path,"status":response.status_code,"type":type[:60],"bytes":len(response.content),"final_url":urlparse(response.url).path,"fields":vals},ensure_ascii=False),flush=True)
 except Exception as e: print(json.dumps({"kind":urlparse(url).path,"error":str(e)[:200]}),flush=True)

for vid in IDS:
 print("VIDEO",vid,flush=True)
 video=f"https://www.tiktok.com/@custrentoc5/video/{vid}"
 probe("https://www.tiktok.com/oembed",HEADERS[0],{"url":video})
 probe(video,HEADERS[0])
 probe(f"https://www.tiktok.com/embed/v2/{vid}",HEADERS[0])
 probe(f"https://www.tiktok.com/player/v1/{vid}?description=1",HEADERS[0])
 probe("https://www.tiktok.com/api/item/detail/",HEADERS[0],{"itemId":vid})
 if vid==IDS[0]: probe(video,HEADERS[1])
