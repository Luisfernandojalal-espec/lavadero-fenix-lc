import { useNavigate } from 'react-router-dom'
import { Header } from '../components/ui'

export default function Credito() {
  const navigate = useNavigate()
  return (
    <>
      <Header title="Crédito" sub="Fiado y abonos de clientes" onBack={() => navigate('/')} />
      <div className="content">
        <div className="empty">
          💳 Este módulo estará listo en la siguiente etapa.<br /><br />
          Aquí vas a manejar los clientes que quedan debiendo (fiado),
          ver cuánto debe cada uno y registrar sus abonos.
        </div>
      </div>
    </>
  )
}
