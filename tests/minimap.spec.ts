import {test,expect} from '@playwright/test';

test('larger minimap labels nearby roads in drive and helicopter views',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const map=page.locator('#minimap'),button=page.locator('#minimap-button');
  const box=await button.boundingBox();
  expect(box!.width).toBeGreaterThan(200);
  expect(box!.width).toBeLessThan(240);
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Boylston Street/);
  await page.screenshot({path:testInfo.outputPath('back-bay-labeled-minimap.png')});

  await button.click();
  await expect(page.locator('#map-modal')).toBeVisible();
  await page.locator('[data-destination="mission-hill"]').click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Huntington Avenue/);
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Hillside Street/);
  await page.screenshot({path:testInfo.outputPath('mission-hill-labeled-minimap.png')});

  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:/);
  const flightMap=await button.boundingBox(),hint=await page.locator('#drive-hint').boundingBox();
  expect(flightMap!.x+flightMap!.width).toBeLessThan(hint!.x);
  await page.screenshot({path:testInfo.outputPath('flight-labeled-minimap.png')});
  expect(errors).toEqual([]);
});
