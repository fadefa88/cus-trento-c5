/*
  CUS Trento C5 CMS custom layer.

  Important:
  This file intentionally does NOT register a Decap CMS preSave handler.
  A previous preSave implementation returned the internal Decap entry object and caused
  content/data.json to be saved with CMS metadata such as partial/path/raw/collection.

  The CMS now writes only isolated files under content/cms/*.json.
  The public site loads content/data.json as the stable base and overlays the CMS files at runtime.
*/
console.info("CUS Trento C5 CMS loaded: data.json is protected; editable data is stored in content/cms/*.json");
