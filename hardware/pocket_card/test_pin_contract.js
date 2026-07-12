const assert = require("assert");
const fs = require("fs");
const path = require("path");

const contractPath = path.join(__dirname, "es3c28p_pin_contract.json");
assert.ok(fs.existsSync(contractPath), `missing pin contract: ${contractPath}`);

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const expectedContract = {
  module: "ES3C28P",
  target: "esp32s3",
  display: {
    controller: "ILI9341V",
    cs: 10,
    dc: 46,
    sck: 12,
    mosi: 11,
    miso: 13,
    backlight: 45,
    reset: "CHIP_PU",
    width: 320,
    height: 240,
  },
  i2c: {
    sda: 16,
    scl: 15,
    addresses: {
      audio_codec: 0x18,
      controls: 0x20,
      touch: 0x38,
    },
  },
  audio: {
    amp_enable: 1,
    mclk: 4,
    bclk: 5,
    data_out: 6,
    lrclk: 7,
    data_in: 8,
  },
  sdmmc: {
    clk: 38,
    cmd: 40,
    data0: 39,
    data1: 41,
    data2: 48,
    data3: 47,
  },
  battery_adc: 9,
  expansion_gpio: [2, 3, 14, 21],
  controls_interrupt_gpio: 2,
  reserved: {
    boot: 0,
    rgb: 42,
    usb_d_minus: 19,
    usb_d_plus: 20,
    uart_rx: 43,
    uart_tx: 44,
  },
  release_touch_enabled: false,
};

assert.deepStrictEqual(contract, expectedContract);

assert.ok(
  contract.expansion_gpio.includes(contract.controls_interrupt_gpio),
  "controls_interrupt_gpio must alias an expansion GPIO",
);

const gpioResources = [
  ...["cs", "dc", "sck", "mosi", "miso", "backlight"].map((name) => [
    `display.${name}`,
    contract.display[name],
  ]),
  ...Object.entries(contract.audio).map(([name, gpio]) => [`audio.${name}`, gpio]),
  ...Object.entries(contract.sdmmc).map(([name, gpio]) => [`sdmmc.${name}`, gpio]),
  ...Object.entries(contract.reserved).map(([name, gpio]) => [`reserved.${name}`, gpio]),
  ["i2c.sda", contract.i2c.sda],
  ["i2c.scl", contract.i2c.scl],
  ["battery_adc", contract.battery_adc],
  ...contract.expansion_gpio.map((gpio, index) => [`expansion_gpio[${index}]`, gpio]),
];

const gpioOwners = new Map();
for (const [resource, gpio] of gpioResources) {
  assert.ok(Number.isInteger(gpio), `${resource} must be an integer GPIO`);
  assert.ok(gpio >= 0 && gpio <= 48, `${resource} GPIO must be in [0, 48]`);
  assert.ok(
    !gpioOwners.has(gpio),
    `${resource} duplicates GPIO ${gpio} used by ${gpioOwners.get(gpio)}`,
  );
  gpioOwners.set(gpio, resource);
}

const i2cAddresses = Object.values(contract.i2c.addresses);
assert.strictEqual(new Set(i2cAddresses).size, i2cAddresses.length, "I2C addresses must be unique");

process.stdout.write("pocket_card_pin_contract: ok\n");
