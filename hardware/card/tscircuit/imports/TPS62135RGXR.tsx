import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["VIN"],
  pin2: ["SW"],
  pin3: ["GND"],
  pin4: ["FB2"],
  pin5: ["FB"],
  pin6: ["VOS"],
  pin7: ["PG"],
  pin8: ["EN"],
  pin9: ["pin9"],
  pin10: ["MODE"],
  pin11: ["VSEL"]
} as const

export const TPS62135RGXR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C167238"
  ]
}}
      manufacturerPartNumber="TPS62135RGXR"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="0mm" pcbY="-0.500126mm" width="1.999996mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0mm" pcbY="0mm" width="1.999996mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="0mm" pcbY="0.499872mm" width="1.999996mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="0.750062mm" pcbY="1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="0.249936mm" pcbY="1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-0.249936mm" pcbY="1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-0.750062mm" pcbY="1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-0.750062mm" pcbY="-1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="-0.249936mm" pcbY="-1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="0.249936mm" pcbY="-1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="0.750062mm" pcbY="-1.400048mm" width="0.2500122mm" height="0.7999984mm" shape="rect" />
<silkscreenpath route={[{"x":-1.2500356000000465,"y":-1.4999970000000076},{"x":-1.2500356000000465,"y":1.4999969999998939}]} />
<silkscreenpath route={[{"x":1.2500356000000465,"y":-1.4999970000000076},{"x":1.2500356000000465,"y":1.4999969999998939}]} />
<silkscreenpath route={[{"x":1.7000727999998162,"y":-1.3999972000001435},{"x":1.6966627929915603,"y":-1.4258987747577976},{"x":1.6866651583089833,"y":-1.450035200000002},{"x":1.6707612182339062,"y":-1.4707616182340644},{"x":1.6500347999999576,"y":-1.4866655583091415},{"x":1.6258983747575257,"y":-1.4966631929917185},{"x":1.5999967999998717,"y":-1.500073200000088},{"x":1.5740952252422176,"y":-1.4966631929917185},{"x":1.549958800000013,"y":-1.4866655583091415},{"x":1.5292323817659508,"y":-1.4707616182340644},{"x":1.5133284416908737,"y":-1.450035200000002},{"x":1.5033308070082967,"y":-1.4258987747577976},{"x":1.4999207999999271,"y":-1.3999972000001435},{"x":1.5033308070082967,"y":-1.374095625242262},{"x":1.5133284416908737,"y":-1.3499591999999438},{"x":1.5292323817659508,"y":-1.329232781766109},{"x":1.549958800000013,"y":-1.3133288416910318},{"x":1.5740952252422176,"y":-1.3033312070083412},{"x":1.5999967999998717,"y":-1.299921200000199},{"x":1.6258983747575257,"y":-1.3033312070083412},{"x":1.6500347999999576,"y":-1.3133288416910318},{"x":1.6707612182339062,"y":-1.329232781766109},{"x":1.6866651583089833,"y":-1.3499591999999438},{"x":1.6966627929915603,"y":-1.374095625242262},{"x":1.7000727999998162,"y":-1.3999972000001435}]} />
<silkscreentext text="{NAME}" pcbX="0.2286mm" pcbY="2.8034mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-1.4945999999999913,"y":2.0534000000000106},{"x":1.9517999999999347,"y":2.0534000000000106},{"x":1.9517999999999347,"y":-2.053399999999897},{"x":-1.4945999999999913,"y":-2.053399999999897},{"x":-1.4945999999999913,"y":2.0534000000000106}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C167238.obj?uuid=c1e9a3cdee614b89a03507056efeecac",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C167238.step?uuid=c1e9a3cdee614b89a03507056efeecac",
        pcbRotationOffset: 180,
        modelOriginPosition: { x: 0, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}