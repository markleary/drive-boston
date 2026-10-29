import {expect,type Page} from '@playwright/test';

/** Clipboard rejection must leave the report usable through native copy UI. */
export async function expectManualReportCopy(page:Page,selector:string){
  const report=page.locator(selector);
  await expect(report).toBeVisible();
  await expect(report).toBeFocused();
  const selected=await report.evaluate((field:HTMLTextAreaElement)=>({
    length:field.value.length,selection:[field.selectionStart,field.selectionEnd],readOnly:field.readOnly,
    userSelect:getComputedStyle(field).userSelect,
    selectAllowed:field.dispatchEvent(new Event('selectstart',{bubbles:true,cancelable:true})),
    menuAllowed:field.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})),
  }));
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.selection).toEqual([0,selected.length]);
  expect(selected.readOnly).toBe(true);
  expect(selected.userSelect).toBe('text');
  expect(selected.selectAllowed).toBe(true);
  expect(selected.menuAllowed).toBe(true);
  expect(await page.locator('#location-label').evaluate(label=>({
    userSelect:getComputedStyle(label).userSelect,
    selectAllowed:label.dispatchEvent(new Event('selectstart',{bubbles:true,cancelable:true})),
    menuAllowed:label.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})),
  }))).toEqual({userSelect:'none',selectAllowed:false,menuAllowed:false});
}
