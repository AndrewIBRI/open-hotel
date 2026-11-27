import { GetRoomSession } from './GetRoomSession';

/**
 * Nome (nick) do usuário por webID (o mesmo id de `user-<webID>` das
 * identidades do LiveKit): consulta o userDataManager da sessão atual
 * e cai no `user-<id>` quando o usuário não está na sala (ex.: entrou
 * por outro quarto e a sessão dele não tem avatar aqui).
 */
export const GetUserNameByWebID = (webID: number): string =>
{
    if(!Number.isFinite(webID) || webID <= 0) return '';

    const userDataManager = GetRoomSession()?.userDataManager;
    const name = userDataManager?.getUserData(webID)?.name;

    return name || `user-${ webID }`;
};
