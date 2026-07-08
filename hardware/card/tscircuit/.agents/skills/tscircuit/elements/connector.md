# `<connector />`

A general-purpose connector component for board-to-board, cable, and edge interfaces.

## Example

```tsx
export default () => (
  <board width="40mm" height="40mm">
    <connector
      name="J1"
      manufacturerPartNumber="AF_QTZB1_0"
      pinLabels={{
        pin1: ["VCC"],
        pin2: ["D_NEG"],
        pin3: ["D_POS"],
        pin4: ["GND"],
        pin5: ["EH1"],
        pin6: ["EH2"],
      }}
      footprint={
        <footprint>
          <hole pcbX="-2.5mm" pcbY="-2.125mm" diameter="1.3mm" />
          <hole pcbX="2.5mm" pcbY="-2.125mm" diameter="1.3mm" />
          <smtpad
            portHints={["pin1"]}
            pcbX="-3.5mm"
            pcbY="1.575mm"
            width="1.1mm"
            height="3.8mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin2"]}
            pcbX="-1mm"
            pcbY="1.575mm"
            width="1.1mm"
            height="3.8mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin3"]}
            pcbX="1mm"
            pcbY="1.575mm"
            width="1.1mm"
            height="3.8mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin4"]}
            pcbX="3.5mm"
            pcbY="1.575mm"
            width="1.1mm"
            height="3.8mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin5"]}
            pcbX="7.15mm"
            pcbY="-1.475mm"
            width="1.8mm"
            height="4mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin6"]}
            pcbX="-7.15mm"
            pcbY="-1.475mm"
            width="1.8mm"
            height="4mm"
            shape="rect"
          />
        </footprint>
      }
    />
  </board>
)
```

## USB-C standard example

```tsx
export default () => (
  <board width="20mm" height="20mm">
    <connector name="USBC" standard="usb_c" pcbX={0} pcbY={0} />
  </board>
)
```

## Accessible orientation warning

Placement checks can warn when a connector faces away from the nearest board edge:

```text
J1 is facing x+ but should face x- so the connector is accessible from the board edge
```

For side-entry connectors, place the connector near the board edge it should face, then use `pcbRotation` if needed so the cable or mating part enters from that edge.

For vertical-entry connectors, such as a battery connector inserted from above, set `insertionDirection="from_above"` on the `<footprint />`. This tells the checker that the connector does not need to face a board edge.

```tsx
<connector
  name="J1"
  pcbX="0"
  pcbY="0"
  footprint={
    <footprint insertionDirection="from_above">
      {/* pads / holes */}
    </footprint>
  }
/>
```

Other insertion directions are `from_left`, `from_right`, `from_front`, and `from_back`.

## Props

Commonly used: `standard`, `name`, `footprint`, `connections`

## References

- Props: [ConnectorProps](https://github.com/tscircuit/props#connectorprops-connector)
- Source: [lib/components/connector.ts](https://github.com/tscircuit/props/blob/main/lib/components/connector.ts)
- Local docs: [docs/docs/elements/connector.mdx](../docs/docs/elements/connector.mdx)
