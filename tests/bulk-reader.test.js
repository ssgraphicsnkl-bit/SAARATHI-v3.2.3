const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseBulkItemFile} = require('../bulk-reader');
async function test() {
  const csv = Buffer.from('Item Name,Category,Price,Notes\r\n"Towel, Large",Cleaning,75,"தமிழ், OK"\r\n');
  const csvRows = await parseBulkItemFile(csv, 'items.csv');
  assert.deepEqual(csvRows[1], ['Towel, Large','Cleaning','75','தமிழ், OK']);
  const file = path.join(__dirname, 'sample.xlsx');
  const excelRows = await parseBulkItemFile(fs.readFileSync(file), 'sample.xlsx');
  assert.equal(excelRows[0][0], 'Item Name');
  assert.equal(excelRows[1][0], 'Towel');
  assert.equal(excelRows[1][3], 'தமிழ், "check"');
  assert.equal(excelRows[2][3], 'Line 1\nLine 2');
  console.log('CSV and Excel import tests passed');
}
test().catch(e => {console.error(e); process.exitCode=1});
