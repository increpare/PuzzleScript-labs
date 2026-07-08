import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin25: ["EH2"],
  pin26: ["EH1"],
  pin27: ["EH3"],
  pin28: ["EH4"],
  pin29: ["A12"],
  pin30: ["B1"],
  pin31: ["A9"],
  pin32: ["B4"],
  pin33: ["B5"],
  pin34: ["A8"],
  pin35: ["B6"],
  pin36: ["A7"],
  pin37: ["A6"],
  pin38: ["B7"],
  pin39: ["A5"],
  pin40: ["B8"],
  pin41: ["B9"],
  pin42: ["A4"],
  pin43: ["B12"],
  pin44: ["A1"]
} as const

export const TYPE_C_16P_CB1_6_073 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2906290"
  ]
}}
      manufacturerPartNumber="TYPE_C_16P_CB1_6_073"
      footprint={<footprint>
        <platedhole  portHints={["pin26"]} pcbX="5.620004mm" pcbY="-2.82505145mm" holeWidth="0.5999988mm" holeHeight="1.6999966mm" outerWidth="0.999998mm" outerHeight="2.0999958mm" shape="pill" />
<platedhole  portHints={["pin25"]} pcbX="5.620004mm" pcbY="1.17494055mm" holeWidth="0.5999988mm" holeHeight="1.2999974mm" outerWidth="0.999998mm" outerHeight="1.6999966mm" shape="pill" />
<platedhole  portHints={["pin27"]} pcbX="-5.620004mm" pcbY="-2.82505145mm" holeWidth="0.5999988mm" holeHeight="1.6999966mm" outerWidth="0.999998mm" outerHeight="2.0999958mm" shape="pill" />
<platedhole  portHints={["pin28"]} pcbX="-5.620004mm" pcbY="1.17494055mm" holeWidth="0.5999988mm" holeHeight="1.2999974mm" outerWidth="0.999998mm" outerHeight="1.6999966mm" shape="pill" />
<smtpad portHints={["pin29"]} pcbX="3.350006mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="3.050032mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="2.549906mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="2.249932mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="1.75006mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="1.249934mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="0.750062mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="0.249936mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="-0.249936mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="-0.750062mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin39"]} pcbX="-1.249934mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin40"]} pcbX="-1.75006mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.249932mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin42"]} pcbX="-2.549906mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin43"]} pcbX="-3.050032mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin44"]} pcbX="-3.350006mm" pcbY="2.32505255mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<silkscreenpath route={[{"x":4.548631999999998,"y":-5.025834450000048},{"x":4.548631999999998,"y":1.5741269499999362}]} />
<silkscreenpath route={[{"x":-4.451426200000014,"y":-5.025834450000048},{"x":-4.451426200000014,"y":1.5741269499999362}]} />
<silkscreenpath route={[{"x":-4.451426200000014,"y":1.5741269499999362},{"x":4.548581199999944,"y":1.5741269499999362}]} />
<silkscreenpath route={[{"x":-4.469968199999926,"y":1.5754731499999934},{"x":4.470019000000093,"y":1.5754731499999934}]} />
<silkscreenpath route={[{"x":4.470019000000093,"y":-4.92453925000018},{"x":4.470019000000093,"y":1.5754731499999934}]} />
<silkscreenpath route={[{"x":-4.469968199999926,"y":-4.92453925000018},{"x":-4.469968199999926,"y":1.5754731499999934}]} />
<silkscreenpath route={[{"x":-4.469968199999926,"y":-4.92453925000018},{"x":4.470019000000093,"y":-4.92453925000018}]} />
<silkscreentext text="{NAME}" pcbX="0.009398mm" pcbY="4.04793655mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-6.362001999999961,"y":3.2979365499999176},{"x":6.380797999999913,"y":3.2979365499999176},{"x":6.380797999999913,"y":-5.279263450000144},{"x":-6.362001999999961,"y":-5.279263450000144},{"x":-6.362001999999961,"y":3.2979365499999176}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2906290.obj?uuid=e149ceda63ee4f5c8235f2af79fd4fac",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2906290.step?uuid=e149ceda63ee4f5c8235f2af79fd4fac",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 1.674978250000072, z: 0.019996799999999704 },
      }}
      {...props}
    />
  )
}