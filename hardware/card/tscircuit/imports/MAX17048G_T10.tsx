import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["CTG"],
  pin2: ["CELL"],
  pin3: ["VDD"],
  pin4: ["GND"],
  pin5: ["ALRT"],
  pin6: ["QSTRT"],
  pin7: ["SCL"],
  pin8: ["SDA"],
  pin9: ["EP"]
} as const

export const MAX17048G_T10 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2682616"
  ]
}}
      manufacturerPartNumber="MAX17048G_T10"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-0.750062mm" pcbY="-0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-0.249936mm" pcbY="-0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="0.249936mm" pcbY="-0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="0.750062mm" pcbY="-0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="0.750062mm" pcbY="0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="0.249936mm" pcbY="0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-0.249936mm" pcbY="0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-0.750062mm" pcbY="0.937514mm" width="0.2800096mm" height="0.4249928mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="0mm" pcbY="-0mm" width="1.1999976mm" height="0.7999984mm" shape="rect" />
<silkscreenpath route={[{"x":-1.076198000000005,"y":1.076198000000005},{"x":-1.076198000000005,"y":-0.5725922000000025}]} />
<silkscreenpath route={[{"x":1.076198000000005,"y":1.076198000000005},{"x":1.076198000000005,"y":-0.5725922000000025}]} />
<silkscreenpath route={[{"x":1.076198000000005,"y":-1.0761980000000193},{"x":1.076198000000005,"y":0.5725921999999883}]} />
<silkscreenpath route={[{"x":-1.076198000000005,"y":-1.0761980000000193},{"x":-1.076198000000005,"y":0.5725921999999883}]} />
<silkscreenpath route={[{"x":-0.6499859999999842,"y":-1.4257020000000153},{"x":-0.6533960070082827,"y":-1.4516035747576836},{"x":-0.6633936416908597,"y":-1.4757400000000018},{"x":-0.6792975817659794,"y":-1.4964664182340215},{"x":-0.7000239999999849,"y":-1.5123703583091412},{"x":-0.7241604252423031,"y":-1.522367992991704},{"x":-0.7500619999999998,"y":-1.5257780000000025},{"x":-0.7759635747576681,"y":-1.522367992991704},{"x":-0.8000999999999863,"y":-1.5123703583091412},{"x":-0.8208264182340059,"y":-1.4964664182340215},{"x":-0.8367303583091257,"y":-1.4757400000000018},{"x":-0.8467279929917026,"y":-1.4516035747576836},{"x":-0.8501380000000012,"y":-1.4257020000000153},{"x":-0.8467279929917026,"y":-1.3998004252423328},{"x":-0.8367303583091257,"y":-1.3756640000000147},{"x":-0.8208264182340059,"y":-1.3549375817659808},{"x":-0.8000999999999863,"y":-1.3390336416908895},{"x":-0.7759635747576681,"y":-1.3290360070083125},{"x":-0.7500619999999998,"y":-1.3256259999999997},{"x":-0.7241604252423031,"y":-1.3290360070083125},{"x":-0.7000239999999849,"y":-1.3390336416908895},{"x":-0.6792975817659794,"y":-1.3549375817659808},{"x":-0.6633936416908597,"y":-1.3756640000000147},{"x":-0.6533960070082827,"y":-1.3998004252423328},{"x":-0.6499859999999842,"y":-1.4257020000000153}]} />
<silkscreentext text="{NAME}" pcbX="0.0127mm" pcbY="2.143mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-1.3168000000000006,"y":1.3929999999999865},{"x":1.3422000000000196,"y":1.3929999999999865},{"x":1.3422000000000196,"y":-1.774000000000001},{"x":-1.3168000000000006,"y":-1.774000000000001},{"x":-1.3168000000000006,"y":1.3929999999999865}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2682616.obj?uuid=9f88ab37f18741bd85a157cdee617c79",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2682616.step?uuid=9f88ab37f18741bd85a157cdee617c79",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0.000012700000013410317, z: -0.02 },
      }}
      {...props}
    />
  )
}