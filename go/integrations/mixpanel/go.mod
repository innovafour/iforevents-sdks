module github.com/innovafour/iforevents-go/integrations/mixpanel

go 1.22

require (
	github.com/innovafour/iforevents-go v0.1.0
	github.com/mixpanel/mixpanel-go v1.2.1
)

require github.com/stretchr/testify v1.11.1 // indirect

replace github.com/innovafour/iforevents-go => ../..
