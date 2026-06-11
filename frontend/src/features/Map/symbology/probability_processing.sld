<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc">
  <UserLayer>
    <sld:LayerFeatureConstraints>
      <sld:FeatureTypeConstraint/>
    </sld:LayerFeatureConstraints>
    <sld:UserStyle>
      <sld:Name>Probability</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:RasterSymbolizer>
            <sld:ChannelSelection>
              <sld:GrayChannel>
                <sld:SourceChannelName>1</sld:SourceChannelName>
              </sld:GrayChannel>
            </sld:ChannelSelection>
            <sld:ColorMap type="intervals">
              <sld:ColorMapEntry label="Not simulated" quantity="0" color="#ffffff" opacity="0"/>
              <sld:ColorMapEntry label="&lt;= 0.0" quantity="0.0000000001" color="#ffffff" opacity="0"/>
              <sld:ColorMapEntry label="0.0 - 0.1" quantity="0.1000000001" color="#00b1f2"/>
              <sld:ColorMapEntry label="0.1 - 0.2" quantity="0.2000000001" color="#faf68e"/>
              <sld:ColorMapEntry label="0.2 - 0.3" quantity="0.3000000001" color="#fcdf4b"/>
              <sld:ColorMapEntry label="0.3 - 0.4" quantity="0.4000000001" color="#fac044"/>
              <sld:ColorMapEntry label="0.4 - 0.5" quantity="0.5000000001" color="#f5a23d"/>
              <sld:ColorMapEntry label="0.5 - 0.6" quantity="0.6000000001" color="#f28938"/>
              <sld:ColorMapEntry label="0.6 - 0.7" quantity="0.7000000001" color="#f06c33"/>
              <sld:ColorMapEntry label="0.7 - 0.8" quantity="0.8000000001" color="#ee4f2c"/>
              <sld:ColorMapEntry label="0.8 - 0.9" quantity="0.9000000001" color="#eb3326" />
              <sld:ColorMapEntry label="> 0.9" quantity="1.0000000001" color="#e6151f"/>
              <sld:ColorMapEntry label="Unprocessed" quantity="2.0000000001" color="#b7b7b7"/>
              <sld:ColorMapEntry label="Processing" quantity="3.0000000001" color="#ff00ff"/>
              <sld:ColorMapEntry label="Existing" quantity="4.0000000001" color="#64292a"/>
            </sld:ColorMap>
          </sld:RasterSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </UserLayer>
</StyledLayerDescriptor>
